"use client";

import { useEffect, useRef, useState } from "react";
import { FileJson, FolderOpen, Play, Plus, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { ProjectCard } from "@/components/projects/project-card";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { useProjectsStore } from "@/src/store/projects";

/**
 * Стартовая страница — список проектов. Показывается при запуске, пока
 * пользователь не откроет проект: рабочая зона без проекта не имеет смысла.
 *
 * Четыре входа в работу: создать пустой, импортировать JSON (R6.4),
 * открыть демонстрационную запись, быстро начать с PCAP.
 */
export function ProjectsScreen() {
  const projects = useProjectsStore((state) => state.projects);
  const busy = useProjectsStore((state) => state.busy);
  const error = useProjectsStore((state) => state.error);
  const clearError = useProjectsStore((state) => state.clearError);
  const loadProjects = useProjectsStore((state) => state.loadProjects);
  const createProject = useProjectsStore((state) => state.createProject);
  const importProjectFile = useProjectsStore(
    (state) => state.importProjectFile,
  );
  const createFromCapture = useProjectsStore(
    (state) => state.createFromCapture,
  );
  const openDemo = useProjectsStore((state) => state.openDemo);
  const openProject = useProjectsStore((state) => state.openProject);
  const deleteProject = useProjectsStore((state) => state.deleteProject);
  const exportProject = useProjectsStore((state) => state.exportProject);

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const pcapInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  // Индекс читается при каждом показе экрана: источник правды — localStorage.
  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const deleting = deleteTarget
    ? projects.find((item) => item.id === deleteTarget) ?? null
    : null;

  const handleCreate = (name: string) => {
    setCreateOpen(false);
    void createProject(name);
  };

  const handleDelete = () => {
    if (deleteTarget) deleteProject(deleteTarget);
    setDeleteTarget(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-sidebar px-4">
        <h1 className="truncate text-sm font-semibold">
          Лаборатория протоколов
        </h1>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          Проекты
        </span>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="size-4" />
              Создать проект
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => jsonInputRef.current?.click()}
            >
              <FileJson className="size-4" />
              Импортировать проект
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void openDemo()}
            >
              <Play className="size-4" />
              Открыть демо
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => pcapInputRef.current?.click()}
            >
              <Upload className="size-4" />
              Загрузить PCAP
            </Button>
          </div>

          <input
            ref={jsonInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importProjectFile(file);
              event.target.value = "";
            }}
          />
          <input
            ref={pcapInputRef}
            type="file"
            accept=".pcap,.pcapng,.cap"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void createFromCapture(file);
              event.target.value = "";
            }}
          />

          {error ? (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3"
            >
              <span className="min-w-0 flex-1 text-xs text-destructive">
                {error}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 shrink-0 px-2"
                onClick={clearError}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ) : null}

          {projects.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-20">
              <FolderOpen className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Нет проектов. Создайте или импортируйте
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  disabled={busy}
                  onOpen={() => void openProject(project.id)}
                  onExport={() => exportProject(project.id)}
                  onDelete={() => setDeleteTarget(project.id)}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      <CreateProjectDialog
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onCreate={handleCreate}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={
          deleting
            ? `Удалить проект «${deleting.name}»?`
            : "Удалить проект?"
        }
        description="Проект и его данные будут удалены из браузера. Действие необратимо."
        confirmLabel="Удалить"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
