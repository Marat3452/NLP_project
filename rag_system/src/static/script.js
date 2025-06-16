// Глобальные переменные
let isDocumentLoaded = false;
let isProcessing = false;

// API базовый URL
const API_BASE = '/api/rag';

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    setupEventListeners();
    checkSystemStatus();
});

// Инициализация приложения
function initializeApp() {
    const fileInput = document.getElementById('fileInput');
    const uploadArea = document.getElementById('uploadArea');
    const questionInput = document.getElementById('questionInput');
    
    // Обработка drag & drop
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('dragleave', handleDragLeave);
    uploadArea.addEventListener('drop', handleDrop);
    
    // Обработка выбора файла
    fileInput.addEventListener('change', handleFileSelect);
    
    // Обработка Enter в поле ввода вопроса
    questionInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendQuestion();
        }
    });
}

// Настройка обработчиков событий
function setupEventListeners() {
    // Клик по области загрузки
    document.getElementById('uploadArea').addEventListener('click', function() {
        document.getElementById('fileInput').click();
    });
}

// Проверка статуса системы
async function checkSystemStatus() {
    try {
        const response = await fetch(`${API_BASE}/status`);
        const data = await response.json();
        
        if (data.document_loaded) {
            showChatSection();
            isDocumentLoaded = true;
        }
    } catch (error) {
        console.error('Ошибка при проверке статуса:', error);
    }
}

// Обработка drag over
function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.add('dragover');
}

// Обработка drag leave
function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('dragover');
}

// Обработка drop
function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('dragover');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        handleFile(files[0]);
    }
}

// Обработка выбора файла
function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
        handleFile(file);
    }
}

// Обработка файла
function handleFile(file) {
    // Проверка типа файла
    if (!file.name.toLowerCase().endsWith('.docx')) {
        showUploadStatus('Поддерживаются только файлы формата DOCX', 'error');
        return;
    }
    
    // Проверка размера файла (максимум 10MB)
    if (file.size > 10 * 1024 * 1024) {
        showUploadStatus('Размер файла не должен превышать 10MB', 'error');
        return;
    }
    
    uploadFile(file);
}

// Загрузка файла
async function uploadFile(file) {
    if (isProcessing) return;
    
    isProcessing = true;
    showUploadProgress();
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        // Симуляция прогресса
        let progress = 0;
        const progressInterval = setInterval(() => {
            progress += Math.random() * 15;
            if (progress > 90) progress = 90;
            updateProgress(progress);
        }, 200);
        
        const response = await fetch(`${API_BASE}/upload`, {
            method: 'POST',
            body: formData
        });
        
        clearInterval(progressInterval);
        updateProgress(100);
        
        const data = await response.json();
        
        if (response.ok) {
            showUploadStatus(`Документ успешно загружен! Обработано ${data.chunks_count} фрагментов.`, 'success');
            setTimeout(() => {
                showChatSection();
                isDocumentLoaded = true;
            }, 1500);
        } else {
            showUploadStatus(data.error || 'Ошибка при загрузке файла', 'error');
        }
    } catch (error) {
        showUploadStatus('Ошибка сети. Проверьте подключение к интернету.', 'error');
        console.error('Ошибка загрузки:', error);
    } finally {
        isProcessing = false;
        setTimeout(hideUploadProgress, 2000);
    }
}

// Показать прогресс загрузки
function showUploadProgress() {
    const progressElement = document.getElementById('uploadProgress');
    progressElement.style.display = 'block';
    updateProgress(0);
}

// Обновить прогресс
function updateProgress(percent) {
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    
    progressFill.style.width = `${percent}%`;
    
    if (percent < 30) {
        progressText.textContent = 'Загрузка файла...';
    } else if (percent < 60) {
        progressText.textContent = 'Анализ документа...';
    } else if (percent < 90) {
        progressText.textContent = 'Создание векторных представлений...';
    } else {
        progressText.textContent = 'Завершение обработки...';
    }
}

// Скрыть прогресс загрузки
function hideUploadProgress() {
    const progressElement = document.getElementById('uploadProgress');
    progressElement.style.display = 'none';
}

// Показать статус загрузки
function showUploadStatus(message, type) {
    const statusElement = document.getElementById('uploadStatus');
    statusElement.textContent = message;
    statusElement.className = `upload-status ${type}`;
    statusElement.style.display = 'block';
    
    if (type === 'error') {
        setTimeout(() => {
            statusElement.style.display = 'none';
        }, 5000);
    }
}

// Показать секцию чата
function showChatSection() {
    document.getElementById('chatSection').style.display = 'block';
    document.getElementById('chatSection').scrollIntoView({ 
        behavior: 'smooth',
        block: 'start'
    });
}

// Отправка вопроса
async function sendQuestion() {
    const questionInput = document.getElementById('questionInput');
    const sendButton = document.getElementById('sendButton');
    const question = questionInput.value.trim();
    
    if (!question || isProcessing || !isDocumentLoaded) return;
    
    // Добавить сообщение пользователя
    addMessage(question, 'user');
    questionInput.value = '';
    
    // Заблокировать интерфейс
    isProcessing = true;
    sendButton.disabled = true;
    questionInput.disabled = true;
    
    // Показать индикатор загрузки
    const loadingMessage = addMessage('Обрабатываю ваш вопрос...', 'bot', true);
    
    try {
        const response = await fetch(`${API_BASE}/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ question })
        });
        
        const data = await response.json();
        
        // Удалить сообщение загрузки
        loadingMessage.remove();
        
        if (response.ok) {
            addMessage(data.answer, 'bot');
        } else {
            addMessage(`Ошибка: ${data.error}`, 'bot');
        }
    } catch (error) {
        loadingMessage.remove();
        addMessage('Ошибка сети. Проверьте подключение к интернету.', 'bot');
        console.error('Ошибка отправки вопроса:', error);
    } finally {
        // Разблокировать интерфейс
        isProcessing = false;
        sendButton.disabled = false;
        questionInput.disabled = false;
        questionInput.focus();
    }
}

// Добавить сообщение в чат
function addMessage(text, sender, isLoading = false) {
    const messagesContainer = document.getElementById('chatMessages');
    const messageElement = document.createElement('div');
    messageElement.className = `message ${sender}-message`;
    
    if (isLoading) {
        messageElement.classList.add('loading');
    }
    
    const avatarIcon = sender === 'user' ? 'fas fa-user' : 'fas fa-robot';
    
    messageElement.innerHTML = `
        <div class="message-avatar">
            <i class="${avatarIcon}"></i>
        </div>
        <div class="message-content">
            <p>${text}</p>
        </div>
    `;
    
    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    return messageElement;
}

// Утилиты для форматирования
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Обработка ошибок
window.addEventListener('error', function(e) {
    console.error('Глобальная ошибка:', e.error);
});

// Обработка необработанных промисов
window.addEventListener('unhandledrejection', function(e) {
    console.error('Необработанная ошибка промиса:', e.reason);
});

