#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager, RunEvent};

const BACKEND_PORT: u16 = 8080;
const BACKEND_BIN: &str = "protocol-lab-api";

struct Sidecar(Mutex<Option<Child>>);

fn sidecar_file_name() -> String {
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x86_64",
        "aarch64" => "aarch64",
        other => other,
    };
    let target = match std::env::consts::OS {
        "linux" => "unknown-linux-gnu",
        "macos" => "apple-darwin",
        "windows" => "pc-windows-msvc",
        other => other,
    };
    if std::env::consts::OS == "windows" {
        format!("{BACKEND_BIN}-{arch}-{target}.exe")
    } else {
        format!("{BACKEND_BIN}-{arch}-{target}")
    }
}

fn find_backend_workspace() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("PROTOCOL_LAB_BACKEND_DIR") {
        let p = PathBuf::from(dir);
        if p.join("fixtures").is_dir() {
            return Some(p);
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        for rel in ["../../../backend", "../../backend", "."] {
            let p = cwd.join(rel);
            if p.join("fixtures").is_dir() {
                return p.canonicalize().ok();
            }
        }
    }
    None
}

fn prepare_workdir(app: &AppHandle) -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    if let Some(ws) = find_backend_workspace() {
        return Some(ws);
    }
    let data_dir = app.path().app_data_dir().ok()?;
    std::fs::create_dir_all(&data_dir).ok()?;
    let res_fixtures = app.path().resource_dir().ok()?.join("fixtures");
    let dst_fixtures = data_dir.join("fixtures");
    if res_fixtures.is_dir() && !dst_fixtures.is_dir() {
        copy_dir_recursive(&res_fixtures, &dst_fixtures);
    }
    Some(data_dir)
}

fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) {
    let Ok(rd) = std::fs::read_dir(src) else {
        return;
    };
    std::fs::create_dir_all(dst).ok();
    for entry in rd.flatten() {
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_dir_recursive(&from, &to);
        } else {
            std::fs::copy(&from, &to).ok();
        }
    }
}

fn find_sidecar_exe(app: &AppHandle) -> Option<PathBuf> {
    let name = sidecar_file_name();
    if let Ok(res) = app.path().resource_dir() {
        for cand in [res.join("binaries").join(&name), res.join(&name)] {
            if cand.is_file() {
                return Some(cand);
            }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        for cand in [
            cwd.join("binaries").join(&name),
            cwd.join("..").join("binaries").join(&name),
        ] {
            if cand.is_file() {
                return Some(cand);
            }
        }
    }
    None
}

fn wait_for_backend() -> bool {
    let addr: SocketAddr = format!("127.0.0.1:{BACKEND_PORT}").parse().unwrap();
    for _ in 0..50 {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

fn main() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .manage(Sidecar(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            let Some(workdir) = prepare_workdir(&handle) else {
                eprintln!("[sidecar] no workdir (no backend workspace, no app_data_dir)");
                return Ok(());
            };
            let Some(exe) = find_sidecar_exe(&handle) else {
                eprintln!("[sidecar] binary not found, backend will not start");
                return Ok(());
            };
            eprintln!("[sidecar] workdir={} exe={}", workdir.display(), exe.display());
            match Command::new(&exe)
                .current_dir(&workdir)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
            {
                Ok(mut child) => {
                    if let Some(out) = child.stdout.take() {
                        std::thread::spawn(move || {
                            for line in BufReader::new(out).lines().flatten() {
                                eprintln!("[backend] {line}");
                            }
                        });
                    }
                    if let Some(err) = child.stderr.take() {
                        std::thread::spawn(move || {
                            for line in BufReader::new(err).lines().flatten() {
                                eprintln!("[backend:err] {line}");
                            }
                        });
                    }
                    handle.state::<Sidecar>().0.lock().unwrap().replace(child);
                    std::thread::spawn(|| {
                        if wait_for_backend() {
                            eprintln!("[sidecar] backend up on 127.0.0.1:{BACKEND_PORT}");
                        } else {
                            eprintln!("[sidecar] backend did not answer in 10s");
                        }
                    });
                }
                Err(e) => eprintln!("[sidecar] spawn failed: {e}"),
            }
            Ok(())
        });
        #[cfg(debug_assertions)]
        {
            builder = builder.plugin(tauri_plugin_mcp_bridge::init());
        }
        builder
        .build(tauri::generate_context!())
        .expect("tauri app build failed")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(mut child) = app.state::<Sidecar>().0.lock().unwrap().take() {
                    child.kill().ok();
                    child.wait().ok();
                    eprintln!("[sidecar] backend stopped");
                }
            }
        });
}
