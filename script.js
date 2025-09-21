// ПОЛНАЯ ФИНАЛЬНАЯ ВЕРСИЯ С СОХРАНЕНИЕМ, ЭКСПОРТОМ И ИМПОРТОМ
document.addEventListener('DOMContentLoaded', () => {
    // --- ИНИЦИАЛИЗАЦИЯ ---
    const panel = document.querySelector('.panel');
    const contentArea = document.getElementById('content-area');
    const exportBtn = document.getElementById('export-btn');
    const importBtn = document.getElementById('import-btn');
    const importZipInput = document.getElementById('import-zip-input');
    
    let selectedElement = null;
    let editingBlock = null;
    let currentModalType = null;
    let currentModalTitle = null;
    
    const modalOverlay = document.getElementById('dialogue-modal-overlay');
    const modalTitle = document.getElementById('modal-title');
    const modalEditableArea = document.getElementById('modal-editable-area');
    const recordBtn = document.getElementById('record-btn');
    const recordStatus = document.getElementById('record-status');
    const audioPreviewContainer = document.getElementById('audio-preview-container');
    const saveDialogueBtn = document.getElementById('save-dialogue-btn');
    const cancelDialogueBtn = document.getElementById('cancel-dialogue-btn');

    let mediaRecorder, audioChunks = [], recordedAudioUrl = null, isRecording = false;
    let userAudioStream = null;
    let selectedCells = [], isSelecting = false, currentTable = null;

    // --- ОБРАБОТЧИКИ СОБЫТИЙ ---
    panel.addEventListener('click', (event) => { if (event.target.matches('.panel-btn[data-type="level"]')) { selectedElement = null; createBlock('level'); } });
    exportBtn.addEventListener('click', exportProjectAsZip);
    importBtn.addEventListener('click', () => importZipInput.click());
    importZipInput.addEventListener('change', importProjectFromZip);
    
    contentArea.addEventListener('click', (event) => {
        const target = event.target;
        if (target.matches('.add-child-btn')) { event.stopPropagation(); selectedElement = target.closest('.block'); const childType = target.dataset.childType; if (childType === 'dialogue' || childType === 'info') openContentModal(childType); else if (childType === 'table') addTable(selectedElement); else createBlock(childType); return; }
        if (target.matches('.delete-btn')) { event.stopPropagation(); deleteBlock(target.closest('.block')); return; }
        if (target.matches('.edit-dialogue-btn')) { event.stopPropagation(); openEditModal(target.closest('.block')); return; }
        if (target.closest('.table-toolbar')) { handleTableToolbar(target); return; }
        if (!target.closest('.custom-table')) { document.querySelectorAll('.table-toolbar').forEach(tb => tb.style.display = 'none'); }
        const clickedBlock = event.target.closest('.block');
        if (selectedElement) selectedElement.classList.remove('is-selected');
        if (clickedBlock) { selectedElement = clickedBlock; selectedElement.classList.add('is-selected'); } else { selectedElement = null; }
        event.stopPropagation();
    });

    contentArea.addEventListener('dblclick', (event) => { if (event.target.matches('.block-header h3')) { editBlockTitle(event.target); } });
    saveDialogueBtn.addEventListener('click', saveModalContent);
    cancelDialogueBtn.addEventListener('click', closeModal);
    recordBtn.addEventListener('click', toggleRecording);
    contentArea.addEventListener('mousedown', (event) => { const cell = event.target.closest('td'); if (!cell) return; isSelecting = true; currentTable = cell.closest('.custom-table'); document.querySelectorAll('.table-toolbar').forEach(tb => tb.style.display = 'none'); currentTable.closest('.table-container').querySelector('.table-toolbar').style.display = 'flex'; if (!event.shiftKey && !event.metaKey && !event.ctrlKey) { clearCellSelection(); } toggleCellSelection(cell); });
    contentArea.addEventListener('mouseover', (event) => { if (!isSelecting) return; event.preventDefault(); const cell = event.target.closest('td'); if (cell && cell.closest('.custom-table') === currentTable) { toggleCellSelection(cell); } });
    document.addEventListener('mouseup', () => { isSelecting = false; });
    
    async function saveState() {
        const structure = serializeDOM(contentArea);
        const structureWithMedia = await processMediaForSaving(structure);
        localStorage.setItem('editorContent', JSON.stringify(structureWithMedia));
    }

    function loadState() {
        const savedState = localStorage.getItem('editorContent');
        if (savedState) {
            try {
                const structure = JSON.parse(savedState);
                contentArea.innerHTML = '';
                if(structure.length === 0){ contentArea.innerHTML = `<div class="placeholder"><h2>Начните работу</h2><p>Нажмите "Создать Level" на панели слева.</p></div>`; } 
                else { buildDOMFromStructure(structure, contentArea); }
            } catch (e) { console.error("Ошибка парсинга сохраненных данных:", e); localStorage.removeItem('editorContent'); }
        }
    }

    function deleteBlock(blockToDelete) { if (!blockToDelete) return; if (confirm('Вы уверены, что хотите удалить этот блок и все его содержимое?')) { if (blockToDelete === selectedElement) { selectedElement = null; } blockToDelete.remove(); saveState(); } }

    function createBlock(type) {
        let title;
        const requiresTitle = ['level', 'unit', 'section', 'subtopic'];
        const optionalTitle = ['grammar'];
        if (requiresTitle.includes(type)) { title = prompt(`Введите заголовок для блока "${type}":`); if (!title || !title.trim()) return; } 
        else if (optionalTitle.includes(type)) { title = prompt(`Введите заголовок для блока "${type}" (необязательно):`); } 
        else { title = type.charAt(0).toUpperCase() + type.slice(1); }
        
        const block = document.createElement('div');
        block.className = 'block';
        block.dataset.blockType = type;
        
        let headerHTML = '';
        if (title && title.trim()) { headerHTML = `<div class="block-header"><h3>${title}</h3><div class="header-controls"><span class="block-type">${type}</span></div></div>`; }
        let contentHTML = '';
        const isContainer = ['level', 'unit', 'section', 'subtopic', 'theory', 'practice'].includes(type);
        const isEditable = ['grammar'].includes(type);
        if (isContainer) contentHTML = `<div class="block-content"></div>`;
        else if (isEditable) contentHTML = `<div class="editable-content" contenteditable="true"></div>`;
        block.innerHTML = `<button class="delete-btn" title="Удалить блок">×</button>${headerHTML}${contentHTML}`;
        
        const parentContentArea = selectedElement ? selectedElement.querySelector(':scope > .block-content') : contentArea;
        if (parentContentArea) {
            if (type === 'level') contentArea.querySelector('.placeholder')?.remove();
            const actionsContainer = parentContentArea.querySelector(':scope > .block-actions');
            if (actionsContainer) parentContentArea.insertBefore(block, actionsContainer);
            else parentContentArea.appendChild(block);
        }
        addContextualButtons(block);
        if(isEditable) makeDraggable(block);
        if(['theory', 'practice'].includes(type)) { const dropZone = block.querySelector('.block-content'); if(dropZone) addDragDropListeners(dropZone); }
        saveState();
    }
    
    function addContextualButtons(block) {
        const type = block.dataset.blockType;
        const contentArea = block.querySelector('.block-content, .editable-content');
        if (!contentArea) return;
        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'block-actions';
        const buttonsToAdd = {
            level: [{ type: 'unit', label: 'Unit' }],
            unit: [{ type: 'section', label: 'Section' }],
            section: [{ type: 'subtopic', label: 'Subtopic' }, { type: 'theory', label: 'Theory' }, { type: 'practice', label: 'Practice' }],
            subtopic: [{ type: 'theory', label: 'Theory' }, { type: 'practice', label: 'Practice' }],
            theory: [{ type: 'grammar', label: 'Grammar' }, { type: 'dialogue', label: 'Dialogue' }, { type: 'info', label: 'Info' }, { type: 'table', label: 'Table' }],
            practice: [{ type: 'dialogue', label: 'Dialogue' }, { type: 'info', label: 'Info' }],
        };
        if (buttonsToAdd[type]) {
            buttonsToAdd[type].forEach(btnInfo => {
                const button = document.createElement('button');
                button.className = 'add-child-btn';
                button.textContent = btnInfo.label;
                button.dataset.childType = btnInfo.type;
                actionsContainer.appendChild(button);
            });
            contentArea.appendChild(actionsContainer);
        }
    }
    
    function editBlockTitle(h3Element) {
        const originalTitle = h3Element.textContent;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = originalTitle;
        h3Element.replaceWith(input);
        input.focus();
        input.select();
        const saveChanges = () => { const newTitle = input.value.trim() || originalTitle; const newH3 = document.createElement('h3'); newH3.textContent = newTitle; input.replaceWith(newH3); saveState(); };
        input.addEventListener('blur', saveChanges, { once: true });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    }

    function formatContent(block) { const editableArea = block.querySelector('.editable-content'); if (!editableArea) return; const isDialogue = block.dataset.blockType === 'dialogue'; let html = editableArea.innerHTML; html = html.replace(/<p>|<\/p>|<div>|<\/div>/gi, '\n'); html = html.replace(/<br\s*\/?>/gi, '\n'); const tempDiv = document.createElement('div'); tempDiv.innerHTML = html; const text = tempDiv.textContent || tempDiv.innerText || ''; const lines = text.split('\n').filter(line => line.trim() !== ''); const colors = ['#e74c3c', '#2ecc71', '#3498db', '#9b59b6']; const characterColorMap = new Map(); if (isDialogue) { Array.from(new Set(lines.map(line => (line.match(/^([^:]+):/)?.[1] || '').trim()).filter(Boolean))).forEach((char, index) => characterColorMap.set(char, colors[index % colors.length])); } const existingElements = Array.from(editableArea.querySelectorAll('img, audio, .table-container')); const newTextHTML = lines.map(line => { const match = line.match(/^([^:]+):(.*)/); const characterName = match ? match[1].trim() : null; if (isDialogue && characterName && characterColorMap.has(characterName)) { return `<p><strong style="color: ${characterColorMap.get(characterName)};">${characterName}:</strong>${match[2] || ''}</p>`; } return `<p>${line}</p>`; }).join(''); editableArea.innerHTML = newTextHTML; existingElements.forEach(el => editableArea.prepend(el)); editableArea.querySelectorAll('img').forEach(img => img.classList.add('resized-image')); saveState(); }
    
    function openContentModal(type) { currentModalType = type; if (type === 'info') { currentModalTitle = prompt('Введите заголовок для блока Info (необязательно):'); modalTitle.textContent = "Создание Info блока"; } else { modalTitle.textContent = "Создание диалогового блока"; } modalOverlay.style.display = 'flex'; }
    function openEditModal(block) { editingBlock = block; const type = block.dataset.blockType; currentModalType = type; modalTitle.textContent = `Редактирование блока (${type})`; const content = block.querySelector('.editable-content'); if (content) { modalEditableArea.innerHTML = content.innerHTML; const audioEl = modalEditableArea.querySelector('audio'); if (audioEl) { showAudioPreview(audioEl.src); audioEl.remove(); } } modalOverlay.style.display = 'flex'; }
    function closeModal() { if (isRecording) mediaRecorder.stop(); modalEditableArea.innerHTML = ''; audioPreviewContainer.innerHTML = ''; recordBtn.disabled = false; recordedAudioUrl = null; editingBlock = null; currentModalType = null; currentModalTitle = null; recordStatus.textContent = ''; modalOverlay.style.display = 'none'; }
    
    function saveModalContent() {
        const content = modalEditableArea.innerHTML;
        if (editingBlock) { const targetContent = editingBlock.querySelector('.editable-content'); if (targetContent) { let audioHTML = ''; if (recordedAudioUrl) audioHTML = `<audio controls src="${recordedAudioUrl}"></audio>`; targetContent.innerHTML = audioHTML + content; formatContent(editingBlock); } } 
        else {
            const parentContentArea = selectedElement.querySelector(':scope > .block-content');
            if (!parentContentArea) { console.error("Не найден родительский контейнер для создания блока."); closeModal(); return; }
            let block;
            if (currentModalType === 'dialogue') { block = document.createElement('div'); block.className = 'block dialogue-wrapper'; block.dataset.blockType = 'dialogue'; let audioHTML = ''; if (recordedAudioUrl) audioHTML = `<audio controls src="${recordedAudioUrl}"></audio>`; block.innerHTML = `<button class="delete-btn" title="Удалить блок">×</button><button class="edit-dialogue-btn" title="Редактировать">✎</button><div
