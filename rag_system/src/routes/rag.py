import os
import tempfile
from flask import Blueprint, request, jsonify
from werkzeug.utils import secure_filename
from langchain_community.document_loaders import UnstructuredWordDocumentLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS
from openai import OpenAI
from dotenv import load_dotenv
from FlagEmbedding import FlagReranker
import logging

# Загрузка переменных окружения
load_dotenv()

rag_bp = Blueprint('rag', __name__)

# Глобальные переменные для хранения состояния
vector_store = None
embeddings = None
client = None
reranker = None

def initialize_models():
    """Инициализация моделей и клиентов"""
    global embeddings, client, reranker
    
    # Создание экземпляра для эмбеддингов
    embeddings = HuggingFaceEmbeddings(
        model_name=os.getenv('EMB_MODEL_NAME', 'BAAI/bge-m3')
    )
    
    # Инициализация клиента OpenAI
    client = OpenAI(
        base_url=os.getenv('BASE_URL'),
        api_key=os.getenv('OPEN_ROUTER_API_KEY'),
    )
    
    # Инициализация reranker
    reranker = FlagReranker(
        os.getenv('RERANKER_MODEL_NAME', 'BAAI/bge-reranker-v2-m3'),
        devices=["cpu"]
    )

@rag_bp.route('/upload', methods=['POST'])
def upload_document():
    """Загрузка и обработка DOCX документа"""
    global vector_store, embeddings
    
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'Файл не найден'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'Файл не выбран'}), 400
        
        if not file.filename.lower().endswith('.docx'):
            return jsonify({'error': 'Поддерживаются только файлы формата DOCX'}), 400
        
        # Инициализация моделей если не инициализированы
        if embeddings is None:
            initialize_models()
        
        # Сохранение временного файла
        filename = secure_filename(file.filename)
        temp_dir = tempfile.mkdtemp()
        temp_path = os.path.join(temp_dir, filename)
        file.save(temp_path)
        
        # Загрузка документа
        loader = UnstructuredWordDocumentLoader(temp_path)
        raw_docs = loader.load()
        
        # Создание сплиттера
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=1024,
            chunk_overlap=128,
            length_function=len,
        )
        
        # Разбиение на фрагменты
        docs = splitter.split_documents(raw_docs)
        
        # Создание векторного хранилища
        vector_store = FAISS.from_documents(docs, embeddings)
        
        # Сохранение в локальное хранилище
        faiss_path = os.path.join(os.path.dirname(__file__), '..', 'faiss_index')
        vector_store.save_local(faiss_path)
        
        # Удаление временного файла
        os.remove(temp_path)
        os.rmdir(temp_dir)
        
        return jsonify({
            'message': 'Документ успешно загружен и обработан',
            'chunks_count': len(docs)
        }), 200
        
    except Exception as e:
        logging.error(f"Ошибка при загрузке документа: {str(e)}")
        return jsonify({'error': f'Ошибка при обработке документа: {str(e)}'}), 500

@rag_bp.route('/chat', methods=['POST'])
def chat():
    """Обработка вопросов пользователя"""
    global vector_store, embeddings, client, reranker
    
    try:
        data = request.get_json()
        if not data or 'question' not in data:
            return jsonify({'error': 'Вопрос не указан'}), 400
        
        question = data['question']
        
        # Инициализация моделей если не инициализированы
        if embeddings is None or client is None or reranker is None:
            initialize_models()
        
        # Загрузка векторного хранилища если не загружено
        if vector_store is None:
            faiss_path = os.path.join(os.path.dirname(__file__), '..', 'faiss_index')
            if not os.path.exists(faiss_path):
                return jsonify({'error': 'Документ не загружен. Сначала загрузите документ.'}), 400
            
            vector_store = FAISS.load_local(
                faiss_path,
                embeddings=embeddings,
                allow_dangerous_deserialization=True
            )
        
        # Поиск по векторному хранилищу
        results = vector_store.similarity_search_with_score(question, k=30)
        results = sorted(results, key=lambda x: x[1], reverse=True)
        
        # Ранжирование результатов
        pairs = [(question, doc.page_content) for doc, _ in results]
        scores = reranker.compute_score(pairs, normalize=True)
        combined = list(zip(results, scores))
        combined_sorted = sorted(combined, key=lambda x: x[1], reverse=True)
        content = [item[0][0].page_content for item in combined_sorted[:5]]  # Берем топ-5
        
        # Загрузка шаблона промпта
        prompt_path = os.path.join(os.path.dirname(__file__), '..', 'prompt.txt')
        if os.path.exists(prompt_path):
            with open(prompt_path, 'r', encoding='utf-8') as f:
                prompt_template = f.read()
        else:
            prompt_template = """Контекст: {context}

Вопрос: {question}

Ответь на вопрос, основываясь на предоставленном контексте. Если информации недостаточно, скажи об этом."""
        
        # Сборка промпта
        model_content = prompt_template.format(
            context='\n\n'.join(content),
            question=question
        )
        
        # Отправка запроса в языковую модель
        completion = client.chat.completions.create(
            model=os.getenv('MODEL_NAME', 'qwen/qwen3-14b:free'),
            messages=[
                {
                    "role": "user",
                    "content": model_content
                }
            ]
        )
        
        answer = completion.choices[0].message.content
        
        return jsonify({
            'answer': answer,
            'sources_count': len(content)
        }), 200
        
    except Exception as e:
        logging.error(f"Ошибка при обработке вопроса: {str(e)}")
        return jsonify({'error': f'Ошибка при обработке вопроса: {str(e)}'}), 500

@rag_bp.route('/status', methods=['GET'])
def status():
    """Проверка статуса системы"""
    global vector_store
    
    faiss_path = os.path.join(os.path.dirname(__file__), '..', 'faiss_index')
    document_loaded = os.path.exists(faiss_path) or vector_store is not None
    
    return jsonify({
        'document_loaded': document_loaded,
        'models_initialized': embeddings is not None and client is not None
    }), 200

