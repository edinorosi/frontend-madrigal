import type { AppService } from "@/src/services/appService";
import { mockService } from "@/src/services/mockService";
import { httpService } from "@/src/services/httpService";

/**
 * ТОЧКА ПОДМЕНЫ. Единственное место, которое меняется при подключении бэкенда.
 *
 * Выбор реализации — по NEXT_PUBLIC_API_URL:
 *   задан  → httpService (бэкенд backend-madrigal, Axum, :8080)
 *   не задан → mockService (оффлайн-разработка на мок-данных)
 *
 * Всё остальное приложение работает через этот символ и о моках/HTTP не знает.
 */
export const appService: AppService = process.env.NEXT_PUBLIC_API_URL
  ? httpService
  : mockService;

/**
 * true — фронт говорит с бэкендом по HTTP (задан NEXT_PUBLIC_API_URL).
 * Используется там, где UI выбирает серверный путь с откатом на локальный:
 * apply через POST apply-model, отчёт/архив/codegen бэкенда.
 */
export function isBackendMode(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_API_URL);
}
