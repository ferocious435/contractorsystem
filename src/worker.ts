import express from 'express';
import { config } from 'dotenv';

// 1. Инициализация конфигурации
config();

const app = express();
const port = process.env.WORKER_PORT || 3001;

// 2. Элегантная обработка порта и запуск
const server = app.listen(port, () => {
  console.log(`🚀 Фоновый воркер запущен на порту ${port}`);
  console.log('🤖 Ожидание задач по обработке документов...');
});

// Обработка ошибок сервера (например, если порт занят)
server.on('error', (e: any) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`❌ Порт ${port} уже занят. Это может быть зомби-процесс. Убейте его вручную.`);
    process.exit(1);
  } else {
    console.error('❌ Ошибка сервера воркера:', e);
    process.exit(1);
  }
});

// 3. Graceful Shutdown (Корректное завершение)
// На Windows Nodemon посылает SIGINT, важно закрыть сервер и остановить ботов/соединения
process.once('SIGINT', () => {
  console.log('🛑 Получен сигнал SIGINT. Закрываем воркер...');
  server.close(() => {
    console.log('✅ Воркер успешно остановлен.');
    process.exit(0);
  });
});

process.once('SIGTERM', () => {
  console.log('🛑 Получен сигнал SIGTERM. Закрываем воркер...');
  server.close(() => {
    console.log('✅ Воркер успешно остановлен.');
    process.exit(0);
  });
});

// Заглушка для логики обработки (здесь будет парсинг документов один за другим)
app.get('/status', (req, res) => {
  res.json({ alive: true, mode: 'worker' });
});

// К папке data обращаемся так: path.join(process.cwd(), 'data', 'session.json')
