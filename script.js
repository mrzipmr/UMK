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
    panel.addEventListener('click', (event) => {
        if (event.target.matches('.panel-btn[data-type="level"]')) {
            selectedElement = null;
            createBlock('level');
        }
    });

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
    
    // --- ФУНКЦИИ СОХРАНЕНИЯ, ЗАГРУЗКИ И УДАЛЕНИЯ ---
    
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
                if(structure.length === 0){
                    contentArea.innerHTML = `<div class="placeholder"><h2>Начните работу</h2><p>Нажмите "Создать Level" на панели слева.</p></div>`;
                } else {
                    buildDOMFromStructure(structure, contentArea);
                }
            } catch (e) {
                console.error("Ошибка парсинга сохраненных данных:", e);
                localStorage.removeItem('editorContent');
            }
        }
    }

    function deleteBlock(blockToDelete) {
        if (!blockToDelete) return;
        if (confirm('Вы уверены, что хотите удалить этот блок и все его содержимое?')) {
            if (blockToDelete === selectedElement) {
                selectedElement = null;
            }
            blockToDelete.remove();
            saveState();
        }
    }

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
        const saveChanges = () => {
            const newTitle = input.value.trim() || originalTitle;
            const newH3 = document.createElement('h3');
            newH3.textContent = newTitle;
            input.replaceWith(newH3);
            saveState();
        };
        input.addEventListener('blur', saveChanges, { once: true });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    }

    function formatContent(block) { const editableArea = block.querySelector('.editable-content'); if (!editableArea) return; const isDialogue = block.dataset.blockType === 'dialogue'; let html = editableArea.innerHTML; html = html.replace(/<p>|<\/p>|<div>|<\/div>/gi, '\n'); html = html.replace(/<br\s*\/?>/gi, '\n'); const tempDiv = document.createElement('div'); tempDiv.innerHTML = html; const text = tempDiv.textContent || tempDiv.innerText || ''; const lines = text.split('\n').filter(line => line.trim() !== ''); const colors = ['#e74c3c', '#2ecc71', '#3498db', '#9b59b6']; const characterColorMap = new Map(); if (isDialogue) { Array.from(new Set(lines.map(line => (line.match(/^([^:]+):/)?.[1] || '').trim()).filter(Boolean))).forEach((char, index) => characterColorMap.set(char, colors[index % colors.length])); } const existingElements = Array.from(editableArea.children).filter(el => el.matches('img, audio, .table-container')); const newTextHTML = lines.map(line => { const match = line.match(/^([^:]+):(.*)/); const characterName = match ? match[1].trim() : null; if (isDialogue && characterName && characterColorMap.has(characterName)) { return `<p><strong style="color: ${characterColorMap.get(characterName)};">${characterName}:</strong>${match[2] || ''}</p>`; } return `<p>${line}</p>`; }).join(''); editableArea.innerHTML = newTextHTML; existingElements.forEach(el => editableArea.prepend(el)); editableArea.querySelectorAll('img').forEach(img => img.classList.add('resized-image')); saveState(); }
    
    function openContentModal(type) {
        currentModalType = type;
        if (type === 'info') {
            currentModalTitle = prompt('Введите заголовок для блока Info (необязательно):');
            modalTitle.textContent = "Создание Info блока";
        } else {
            modalTitle.textContent = "Создание диалогового блока";
        }
        modalOverlay.style.display = 'flex';
    }

    function openEditModal(block) {
        editingBlock = block;
        const type = block.dataset.blockType;
        currentModalType = type;
        modalTitle.textContent = `Редактирование блока (${type})`;
        const content = block.querySelector('.editable-content');
        if (content) {
            modalEditableArea.innerHTML = content.innerHTML;
            const audioEl = modalEditableArea.querySelector('audio');
            if (audioEl) { showAudioPreview(audioEl.src); audioEl.remove(); }
        }
        modalOverlay.style.display = 'flex';
    }

    function closeModal() { if (isRecording) mediaRecorder.stop(); modalEditableArea.innerHTML = ''; audioPreviewContainer.innerHTML = ''; recordBtn.disabled = false; recordedAudioUrl = null; editingBlock = null; currentModalType = null; currentModalTitle = null; recordStatus.textContent = ''; modalOverlay.style.display = 'none'; }
    
    function saveModalContent() {
        const content = modalEditableArea.innerHTML;
        if (editingBlock) {
            const targetContent = editingBlock.querySelector('.editable-content');
            if (targetContent) { let audioHTML = ''; if (recordedAudioUrl) audioHTML = `<audio controls src="${recordedAudioUrl}"></audio>`; targetContent.innerHTML = audioHTML + content; formatContent(editingBlock); }
        } else {
            const parentContentArea = selectedElement.querySelector(':scope > .block-content');
            if (!parentContentArea) { console.error("Не найден родительский контейнер для создания блока."); closeModal(); return; }
            let block;
            if (currentModalType === 'dialogue') {
                block = document.createElement('div'); block.className = 'block dialogue-wrapper'; block.dataset.blockType = 'dialogue';
                let audioHTML = ''; if (recordedAudioUrl) audioHTML = `<audio controls src="${recordedAudioUrl}"></audio>`;
                block.innerHTML = `<button class="delete-btn" title="Удалить блок">×</button><button class="edit-dialogue-btn" title="Редактировать">✎</button><div class="editable-content" contenteditable="true">${audioHTML}${content}</div>`;
            } else if (currentModalType === 'info') {
                block = document.createElement('div'); block.className = 'block'; block.dataset.blockType = 'info';
                let audioHTML = ''; if (recordedAudioUrl) audioHTML = `<audio controls src="${recordedAudioUrl}"></audio>`;
                let headerHTML = ''; if (currentModalTitle && currentModalTitle.trim()) { headerHTML = `<div class="block-header"><h3>${currentModalTitle}</h3><div class="header-controls"><span class="block-type">info</span></div></div>`; }
                block.innerHTML = `<button class="delete-btn" title="Удалить блок">×</button><button class="edit-dialogue-btn" title="Редактировать">✎</button>${headerHTML}<div class="editable-content" contenteditable="true">${audioHTML}${content}</div>`;
            }
            if (block) {
                const actionsContainer = parentContentArea.querySelector(':scope > .block-actions');
                parentContentArea.insertBefore(block, actionsContainer);
                formatContent(block);
                makeDraggable(block);
            }
        }
        closeModal();
    }

    function showAudioPreview(url) { recordedAudioUrl = url; audioPreviewContainer.innerHTML = `<audio controls src="${url}"></audio><button id="delete-audio-btn" title="Удалить запись">×</button>`; recordBtn.disabled = true; document.getElementById('delete-audio-btn').addEventListener('click', deleteRecording); }
    function deleteRecording() { audioPreviewContainer.innerHTML = ''; recordedAudioUrl = null; recordBtn.disabled = false; recordStatus.textContent = 'Запись удалена.'; }
    async function getAudioStream() { if (userAudioStream && userAudioStream.getAudioTracks().some(track => track.readyState === 'live')) { return userAudioStream; } try { userAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true }); return userAudioStream; } catch (err) { console.error("Ошибка доступа к микрофону:", err); recordStatus.textContent = 'Ошибка: нужен доступ к микрофону.'; return null; } }
    async function toggleRecording() { if (isRecording) { mediaRecorder.stop(); } else { const stream = await getAudioStream(); if (!stream) return; mediaRecorder = new MediaRecorder(stream); mediaRecorder.start(); isRecording = true; recordBtn.textContent = 'Остановить запись'; recordBtn.classList.add('is-recording'); recordStatus.textContent = 'Идет запись...'; audioChunks = []; mediaRecorder.addEventListener('dataavailable', event => audioChunks.push(event.data)); mediaRecorder.addEventListener('stop', () => { isRecording = false; recordBtn.textContent = 'Записать голос'; recordBtn.classList.remove('is-recording'); recordStatus.textContent = 'Запись завершена!'; const audioBlob = new Blob(audioChunks, { type: 'audio/webm' }); const audioUrl = URL.createObjectURL(audioBlob); showAudioPreview(audioUrl); stream.getTracks().forEach(track => track.stop()); }); } }
    
    function addTable(block) { const contentDiv = block.querySelector(':scope > .block-content'); if (!contentDiv) return; const tableContainer = document.createElement('div'); tableContainer.className = 'table-container'; tableContainer.setAttribute('contenteditable', 'false'); tableContainer.innerHTML = `<div class="table-toolbar"><button data-action="merge">Merge</button><button data-action="deleteCells">Delete Rows</button><button data-action="addRow">Add Row</button><button data-action="addCol">Add Col</button></div><table class="custom-table"><tbody><tr><td contenteditable="true"></td><td contenteditable="true"></td></tr><tr><td contenteditable="true"></td><td contenteditable="true"></td></tr></tbody></table>`; const actionsContainer = contentDiv.querySelector(':scope > .block-actions'); contentDiv.insertBefore(tableContainer, actionsContainer); makeDraggable(tableContainer); saveState(); }
    function handleTableToolbar(button) { const action = button.dataset.action; if (!action) return; switch (action) { case 'merge': mergeCells(); break; case 'deleteCells': deleteSelectedCells(); break; case 'addRow': addRow(currentTable); break; case 'addCol': addCol(currentTable); break; } }
    function deleteSelectedCells() { if (selectedCells.length === 0) { alert("Пожалуйста, выделите ячейки, строки которых вы хотите удалить."); return; } if (confirm("Вы уверены, что хотите удалить все СТРОКИ, содержащие выделенные ячейки?")) { const rowsToDelete = new Set(); selectedCells.forEach(cell => { const row = cell.closest('tr'); if (row) rowsToDelete.add(row); }); rowsToDelete.forEach(row => row.remove()); if (currentTable && currentTable.querySelectorAll('tr').length === 0) { currentTable.closest('.table-container').remove(); } clearCellSelection(); } }
    function toggleCellSelection(cell) { if (!selectedCells.includes(cell)) { cell.classList.add('cell-selected'); selectedCells.push(cell); } }
    function clearCellSelection() { selectedCells.forEach(cell => cell.classList.remove('cell-selected')); selectedCells = []; }
    function mergeCells() { if (selectedCells.length < 2) return; let primaryCell = selectedCells.reduce((prev, curr) => { const prevRowIndex = prev.parentElement.rowIndex; const currRowIndex = curr.parentElement.rowIndex; if (currRowIndex < prevRowIndex) return curr; if (currRowIndex === prevRowIndex && curr.cellIndex < prev.cellIndex) return curr; return prev; }); let colSpan = 0, rowSpan = 0; let content = []; selectedCells.forEach(cell => { colSpan = Math.max(colSpan, cell.cellIndex + (cell.colSpan || 1)); rowSpan = Math.max(rowSpan, cell.parentElement.rowIndex + (cell.rowSpan || 1)); if (cell.innerHTML) content.push(cell.innerHTML); }); primaryCell.colSpan = colSpan - primaryCell.cellIndex; primaryCell.rowSpan = rowSpan - primaryCell.parentElement.rowIndex; primaryCell.innerHTML = content.join('<br>'); selectedCells.filter(cell => cell !== primaryCell).forEach(cell => cell.remove()); clearCellSelection(); }
    function addRow(table) { if (!table) return; const firstRow = table.querySelector('tr'); const colCount = firstRow ? Array.from(firstRow.cells).reduce((acc, cell) => acc + (cell.colSpan || 1), 0) : 1; const newRow = table.querySelector('tbody').insertRow(); for (let i = 0; i < colCount; i++) { newRow.insertCell().setAttribute('contenteditable', 'true'); } }
    function addCol(table) { if (!table) return; table.querySelectorAll('tr').forEach(row => { row.insertCell().setAttribute('contenteditable', 'true'); }); }

    function makeDraggable(element) { element.draggable = true; element.addEventListener('dragstart', (e) => { e.stopPropagation(); element.classList.add('dragging'); }); element.addEventListener('dragend', (e) => { e.stopPropagation(); element.classList.remove('dragging'); saveState(); }); }
    function addDragDropListeners(container) {
        container.addEventListener('dragover', e => {
            e.preventDefault(); e.stopPropagation();
            const afterElement = getDragAfterElement(container, e.clientY);
            const draggable = document.querySelector('.dragging');
            if (draggable) {
                 if (afterElement == null) { container.insertBefore(draggable, container.querySelector('.block-actions')); } else { container.insertBefore(draggable, afterElement); }
            }
        });
    }
    function getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll(':scope > .block, :scope > .table-container, :scope > .dialogue-wrapper')].filter(el => !el.classList.contains('dragging'));
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) { return { offset: offset, element: child }; } else { return closest; }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    // --- ФУНКЦИИ ДЛЯ СЕРИАЛИЗАЦИИ, ЭКСПОРТА И ИМПОРТА ---
    function serializeDOM(rootElement) {
        const children = [...rootElement.querySelectorAll(':scope > .block, :scope > .dialogue-wrapper')];
        return children.map(child => {
            const data = {
                type: child.dataset.blockType,
                title: child.querySelector('.block-header h3')?.textContent || null,
                content: child.querySelector('.editable-content')?.innerHTML || null,
                children: []
            };
            const contentContainer = child.querySelector(':scope > .block-content');
            if (contentContainer) {
                data.children = serializeDOM(contentContainer);
            }
            return data;
        });
    }
    async function processMediaForSaving(structure) {
        for (const block of structure) {
            if (block.content) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = block.content;
                const mediaElements = tempDiv.querySelectorAll('img, audio');
                for (const el of mediaElements) {
                    if (el.src.startsWith('blob:')) {
                        const response = await fetch(el.src);
                        const blob = await response.blob();
                        const base64 = await new Promise(resolve => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result);
                            reader.readAsDataURL(blob);
                        });
                        el.src = base64;
                    }
                }
                block.content = tempDiv.innerHTML;
            }
            if (block.children.length > 0) {
                await processMediaForSaving(block.children);
            }
        }
        return structure;
    }
    function buildDOMFromStructure(structure, parentElement) {
        structure.forEach(data => {
            const block = document.createElement('div');
            block.className = 'block' + (data.type === 'dialogue' ? ' dialogue-wrapper' : '');
            block.dataset.blockType = data.type;
            let headerHTML = '';
            if (data.title) { headerHTML = `<div class="block-header"><h3>${data.title}</h3><div class="header-controls"><span class="block-type">${data.type}</span></div></div>`; }
            let contentHTML = '';
            const isContainer = ['level', 'unit', 'section', 'subtopic', 'theory', 'practice'].includes(data.type);
            const isEditable = ['grammar', 'info', 'dialogue'].includes(data.type);
            if (isContainer) contentHTML = `<div class="block-content"></div>`;
            else if (isEditable) contentHTML = `<div class="editable-content" contenteditable="true">${data.content || ''}</div>`;
            
            let buttonsHTML = `<button class="delete-btn" title="Удалить блок">×</button>`;
            if(data.type === 'dialogue' || data.type === 'info') {
                buttonsHTML += `<button class="edit-dialogue-btn" title="Редактировать">✎</button>`;
            }
            
            if(data.type === 'dialogue') block.innerHTML = `${buttonsHTML}${contentHTML}`;
            else block.innerHTML = `${buttonsHTML}${headerHTML}${contentHTML}`;
            
            parentElement.appendChild(block);

            if (data.children && data.children.length > 0) {
                buildDOMFromStructure(data.children, block.querySelector(':scope > .block-content'));
            }
            addContextualButtons(block);
            if(isEditable || data.type === 'table') makeDraggable(block);
            if(['theory', 'practice'].includes(data.type)) addDragDropListeners(block.querySelector('.block-content'));
        });
    }
    async function exportProjectAsZip() {
        const zip = new JSZip();
        const dataFolder = zip.folder('data');
        const imagesFolder = dataFolder.folder('images');
        const audioFolder = dataFolder.folder('audio');
        const structure = serializeDOM(contentArea);
        let fileCounter = 0;
        async function processNodeForExport(node) {
            if (node.content) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = node.content;
                const mediaElements = tempDiv.querySelectorAll('img, audio');
                for (const el of mediaElements) {
                    if (el.src.startsWith('data:')) {
                        fileCounter++;
                        const [header, base64Data] = el.src.split(',');
                        const mimeType = header.match(/:(.*?);/)[1];
                        const extension = mimeType.split('/')[1].split('+')[0];
                        const isAudio = mimeType.startsWith('audio');
                        const folder = isAudio ? audioFolder : imagesFolder;
                        const folderPath = isAudio ? 'data/audio' : 'data/images';
                        const fileName = `${isAudio ? 'audio' : 'img'}-${fileCounter}.${extension}`;
                        folder.file(fileName, base64Data, { base64: true });
                        el.src = `${folderPath}/${fileName}`;
                    }
                }
                node.content = tempDiv.innerHTML;
            }
            for (const child of node.children) { await processNodeForExport(child); }
        }
        for (const node of structure) { await processNodeForExport(node); }
        zip.file('project.json', JSON.stringify(structure, null, 2));
        const staticHtml = `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>Просмотр проекта</title><style>body{font-family:sans-serif;max-width:800px;margin:20px auto;line-height:1.6;} .block{border:1px solid #ccc;padding:15px;margin-bottom:15px;border-radius:5px;} .block-content{margin-left:20px;} h3{margin-top:0;} img,audio{max-width:100%;}</style></head><body><h1>Просмотр проекта</h1><div id="project-content"></div><script>
        fetch('project.json').then(res=>res.json()).then(data => {
            const container = document.getElementById('project-content');
            function render(nodes, parent) {
                nodes.forEach(node => {
                    const el = document.createElement('div'); el.className = 'block';
                    let inner = ''; if(node.title) inner += '<h3>' + node.title + '</h3>';
                    if(node.content) inner += '<div>' + node.content + '</div>';
                    const contentDiv = document.createElement('div'); contentDiv.className = 'block-content';
                    el.innerHTML = inner; el.appendChild(contentDiv); parent.appendChild(el);
                    if(node.children && node.children.length) render(node.children, contentDiv);
                });
            }
            render(data, container);
        });
        <\/script></body></html>`;
        zip.file('index.html', staticHtml);
        const content = await zip.generateAsync({ type: 'blob' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(content);
        link.download = 'project.zip';
        link.click();
    }
    async function importProjectFromZip(event) {
        const file = event.target.files[0];
        if (!file) return;
        if(!confirm("Импорт нового проекта заменит все текущее содержимое. Продолжить?")) { event.target.value = ''; return; }
        const zip = await JSZip.loadAsync(file);
        const projectJsonFile = zip.file('project.json');
        if (!projectJsonFile) { alert('Ошибка: Файл project.json не найден в архиве.'); return; }
        const structure = JSON.parse(await projectJsonFile.async('string'));
        async function rehydrateMedia(node) {
            if (node.content) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = node.content;
                const mediaElements = tempDiv.querySelectorAll('img, audio');
                for (const el of mediaElements) {
                    const filePath = el.getAttribute('src');
                    const fileInZip = zip.file(filePath);
                    if (fileInZip) {
                        const base64Data = await fileInZip.async('base64');
                        const mimeType = filePath.includes('audio') ? 'audio/webm' : 'image/png';
                        el.src = `data:${mimeType};base64,${base64Data}`;
                    }
                }
                node.content = tempDiv.innerHTML;
            }
            for (const child of node.children) { await rehydrateMedia(child); }
        }
        for (const node of structure) { await rehydrateMedia(node); }
        localStorage.setItem('editorContent', JSON.stringify(structure));
        loadState();
        event.target.value = '';
    }

    loadState();
});