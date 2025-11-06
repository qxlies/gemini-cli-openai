# Примеры использования прокси - Быстрый старт

## 🚀 Самые частые сценарии

### Сценарий 1: Корпоративный прокси без аутентификации

**Ситуация:** Вы в корпоративной сети, прокси на `proxy.company.com:8080`

```bash
# .env
HTTPS_PROXY=http://proxy.company.com:8080
```

**Логи при запуске:**
```
[Proxy] Using proxy for https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse: http://proxy.company.com:8080
[GeminiAPI] Stream request will be routed through proxy
```

---

### Сценарий 2: Прокси с логином и паролем

**Ситуация:** Прокси требует аутентификацию

```bash
# .env
HTTPS_PROXY=http://john.doe:MySecurePass123@proxy.company.com:3128
```

**Логи при запуске:**
```
[Proxy] Using proxy for https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse: http://john.doe:***@proxy.company.com:3128
[GeminiAPI] Stream request will be routed through proxy
```

**⚠️ Важно:** Пароль замаскирован в логах как `***`

---

### Сценарий 3: Прокси с исключениями

**Ситуация:** Нужно обойти прокси для локальных сервисов

```bash
# .env
HTTPS_PROXY=http://proxy.company.com:8080
NO_PROXY=localhost,127.0.0.1,.internal.local
```

**Логи при запуске:**
```
[Proxy] Using proxy for https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse: http://proxy.company.com:8080
[GeminiAPI] Stream request will be routed through proxy
```

**Логи при запросе к локальному сервису:**
```
[Proxy] Bypassing proxy for host: internal.local (matched NO_PROXY rules)
[GeminiAPI] Stream request will be sent directly (no proxy)
```

---

### Сценарий 4: Без прокси (по умолчанию)

**Ситуация:** Прямое подключение к интернету

```bash
# .env
# Прокси не установлен
```

**Логи при запуске:**
```
[Proxy] No proxy configured in environment variables
[GeminiAPI] Stream request will be sent directly (no proxy)
```

---

## 📋 Полные примеры конфигурации

### Пример A: Минимальная конфигурация

```bash
# .env
HTTPS_PROXY=http://proxy.example.com:8080
```

### Пример B: Полная конфигурация

```bash
# .env
# Прокси
HTTPS_PROXY=http://admin:password@proxy.company.com:3128

# Исключения
NO_PROXY=localhost,127.0.0.1,.company.local,.googleapis.com

# Другие переменные
GEMINI_API_KEY=your-api-key
ENABLE_REAL_THINKING=true
```

### Пример C: Множественные прокси для разных протоколов

```bash
# .env
# HTTPS прокси (приоритет выше)
HTTPS_PROXY=http://proxy-https.company.com:8080

# HTTP прокси (если нужен)
HTTP_PROXY=http://proxy-http.company.com:8080

# Исключения
NO_PROXY=localhost,127.0.0.1
```

### Пример D: Использование переменных системы

```bash
# Установить в системе (Linux/Mac)
export HTTPS_PROXY=http://proxy.company.com:8080
export NO_PROXY=localhost,127.0.0.1

# Или в Windows (PowerShell)
$env:HTTPS_PROXY="http://proxy.company.com:8080"
$env:NO_PROXY="localhost,127.0.0.1"

# Запустить приложение
npm start
```

---

## 🔍 Проверка конфигурации

### Проверить переменные окружения

```bash
# Linux/Mac
echo "HTTPS_PROXY: $HTTPS_PROXY"
echo "NO_PROXY: $NO_PROXY"

# Windows (PowerShell)
echo "HTTPS_PROXY: $env:HTTPS_PROXY"
echo "NO_PROXY: $env:NO_PROXY"
```

### Проверить доступность прокси

```bash
# Проверить соединение с прокси
curl -v -x http://proxy.company.com:8080 https://cloudcode-pa.googleapis.com

# Или с аутентификацией
curl -v -x http://user:pass@proxy.company.com:8080 https://cloudcode-pa.googleapis.com
```

### Проверить логи приложения

```bash
# Запустить приложение и смотреть логи
npm start

# Ищите сообщения:
# [Proxy] Using proxy for ...
# [GeminiAPI] Stream request will be routed through proxy
```

---

## 🎯 Тестирование API с прокси

### Пример 1: Простой запрос через curl

```bash
# Установить переменные окружения
export HTTPS_PROXY=http://proxy.company.com:8080

# Запустить приложение
npm start

# В другом терминале, отправить запрос
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

### Пример 2: Запрос с потоком (streaming)

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [
      {"role": "user", "content": "Tell me a story"}
    ],
    "stream": true
  }'
```

### Пример 3: Проверка доступных моделей

```bash
curl http://localhost:3000/v1/models
```

---

## 📊 Интерпретация логов

### Успешное использование прокси

```
[Proxy] Using proxy for https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse: http://proxy.company.com:8080
[GeminiAPI] Attempt 1/1 using account index 0, project default-project
[GeminiAPI] Stream request will be routed through proxy
[GeminiAPI] Starting stream generation
```

✅ **Что это означает:** Запрос успешно маршрутизируется через прокси

---

### Прямое подключение (без прокси)

```
[Proxy] No proxy configured in environment variables
[GeminiAPI] Attempt 1/1 using account index 0, project default-project
[GeminiAPI] Stream request will be sent directly (no proxy)
[GeminiAPI] Starting stream generation
```

✅ **Что это означает:** Запрос отправляется напрямую без прокси

---

### Исключение хоста из прокси

```
[Proxy] Bypassing proxy for host: internal.local (matched NO_PROXY rules)
[GeminiAPI] Stream request will be sent directly (no proxy)
```

✅ **Что это означает:** Хост исключен из прокси, используется прямое подключение

---

### Ошибка при создании прокси

```
[Proxy] Error creating proxy dispatcher: Connection refused
```

❌ **Что это означает:** Не удается подключиться к прокси-серверу
- Проверьте адрес и порт прокси
- Проверьте доступность прокси-сервера
- Проверьте сетевые правила и firewall

---

## 🛠️ Решение проблем

### Проблема: "Connection refused"

```bash
# Проверить доступность прокси
ping proxy.company.com
telnet proxy.company.com 8080

# Проверить конфигурацию
echo $HTTPS_PROXY
```

### Проблема: "Authentication failed"

```bash
# Проверить логин и пароль
# Убедитесь, что пароль правильно экранирован

# Если пароль содержит спецсимволы, используйте кавычки
HTTPS_PROXY="http://user:p@ssw0rd@proxy.company.com:8080"
```

### Проблема: "Bypassing proxy" для нужного хоста

```bash
# Проверить NO_PROXY
echo $NO_PROXY

# Убедитесь, что хост НЕ в списке исключений
# Если нужно использовать прокси для этого хоста, удалите его из NO_PROXY
```

### Проблема: Прокси не используется

```bash
# Проверить, что переменная установлена
echo $HTTPS_PROXY

# Если пусто, установить:
export HTTPS_PROXY=http://proxy.company.com:8080

# Перезапустить приложение
npm start
```

---

## 📚 Дополнительные команды

### Просмотр всех переменных окружения

```bash
# Linux/Mac
env | grep -i proxy

# Windows (PowerShell)
Get-ChildItem env: | Where-Object {$_.Name -like "*proxy*"}
```

### Очистить переменные прокси

```bash
# Linux/Mac
unset HTTPS_PROXY
unset HTTP_PROXY
unset NO_PROXY

# Windows (PowerShell)
Remove-Item env:HTTPS_PROXY
Remove-Item env:HTTP_PROXY
Remove-Item env:NO_PROXY
```

### Установить прокси только для текущей сессии

```bash
# Linux/Mac
HTTPS_PROXY=http://proxy.company.com:8080 npm start

# Windows (PowerShell)
$env:HTTPS_PROXY="http://proxy.company.com:8080"; npm start
```

---

## ✅ Чек-лист для настройки прокси

- [ ] Определить адрес и порт прокси-сервера
- [ ] Проверить, требуется ли аутентификация
- [ ] Определить хосты для исключения (NO_PROXY)
- [ ] Добавить переменные в `.env` файл
- [ ] Запустить приложение: `npm start`
- [ ] Проверить логи на наличие `[Proxy]` сообщений
- [ ] Отправить тестовый запрос к API
- [ ] Убедиться, что запрос успешно обработан

---

## 🔗 Связанные файлы

- [`src/config.ts`](src/config.ts) - Реализация `getProxyDispatcher()`
- [`src/gemini-client.ts`](src/gemini-client.ts) - Использование прокси в запросах
- [`PROXY_USAGE.md`](PROXY_USAGE.md) - Полная документация по прокси
