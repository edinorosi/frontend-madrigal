"use client";

import { useRef, type ComponentProps } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/src/store/app";

type ButtonProps = ComponentProps<typeof Button>;

/**
 * Открывает системный выбор файла и передаёт его в startImport.
 * Импорт ничего не парсит на фронте — этим занимается сервис.
 */
export function ImportButton({
  children = "Загрузить PCAP",
  ...props
}: ButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const startImport = useAppStore((state) => state.startImport);
  const running = useAppStore((state) => state.importPhase === "running");

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".pcap,.pcapng,.cap"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void startImport(file);
          }
          event.target.value = "";
        }}
      />
      <Button
        {...props}
        disabled={running || props.disabled}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="size-4" />
        {children}
      </Button>
    </>
  );
}
