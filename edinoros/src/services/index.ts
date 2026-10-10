import type { AppService } from "@/src/services/appService";
import { mockService } from "@/src/services/mockService";

/**
 * ТОЧКА ПОДМЕНЫ. Единственное место, которое меняется при подключении бэкенда:
 *
 *   export const appService: AppService = backendService;
 *
 * Всё остальное приложение работает через этот символ и о моках не знает.
 */
export const appService: AppService = mockService;
