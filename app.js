// --- SISTEMA DE AUDIO (PITIDOS) ---
let isSoundEnabled = true;
let audioCtx = null;

function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    // Desbloqueo silencioso para iOS
    const unlockOscillator = audioCtx.createOscillator();
    const unlockGain = audioCtx.createGain();
    unlockOscillator.connect(unlockGain);
    unlockGain.connect(audioCtx.destination);
    unlockGain.gain.value = 0; 
    unlockOscillator.start(audioCtx.currentTime);
    unlockOscillator.stop(audioCtx.currentTime + 0.01);
}

function playBeep(type) {
    if (!isSoundEnabled || !audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    if (type === 'countdown') {
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(440, audioCtx.currentTime); 
        gainNode.gain.setValueAtTime(1, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
        oscillator.start(audioCtx.currentTime);
        oscillator.stop(audioCtx.currentTime + 0.2);
    } else if (type === 'start') {
        oscillator.type = 'square';
        oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); 
        gainNode.gain.setValueAtTime(1, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
        oscillator.start(audioCtx.currentTime);
        oscillator.stop(audioCtx.currentTime + 0.4);
    }
}

// --- BLOQUEO DE PANTALLA ENCENDIDA (WAKE LOCK API) ---
let wakeLockSentinel = null;

async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            wakeLockSentinel = await navigator.wakeLock.request('screen');
        } catch (_) {}
    }
}

function releaseWakeLock() {
    if (wakeLockSentinel) {
        wakeLockSentinel.release().catch(() => {});
        wakeLockSentinel = null;
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && animFrameId && !isPaused) {
        requestWakeLock();
    }
});

// --- PRECARGA DE IMÁGENES EN SEGUNDO PLANO ---
const preloadedImageCache = {};

function preloadAllImages() {
    const uniqueUrls = new Set();
    workoutsData.forEach(workout => {
        workout.routine.forEach(step => {
            if (step.png && step.png !== "") {
                uniqueUrls.add(step.png);
            }
        });
    });

    uniqueUrls.forEach(url => {
        if (!preloadedImageCache[url]) {
            const img = new Image();
            img.src = url;
            if (img.decode) {
                img.decode().catch(() => {});
            }
            preloadedImageCache[url] = img;
        }
    });
}

let currentRoutine = [];
let currentStepIndex = 0;
let currentStepDuration = 1;
let totalWorkoutTime = 0;
let futureStepsTime = 0;
let prestartInterval = null;
let finishTimeoutId = null;
let animFrameId = null;
let isPaused = false;

// Variables de control de tiempo continuo (60/120fps)
let stepEndTimestamp = 0;
let pausedRemainingMs = 0;
let lastDisplayedSecond = -1;

// Constantes geométricas de los dos anillos (viewBox 220x220)
const OUTER_R = 96;
const OUTER_C = 2 * Math.PI * OUTER_R; 
const INNER_R = 78;
const INNER_C = 2 * Math.PI * INNER_R; 

const screenSelector = document.getElementById('screen-selector');
const screenWorkout = document.getElementById('screen-workout');
const listContainer = document.getElementById('workout-list');
const elWorkoutTitle = document.getElementById('current-workout-title');
const elStepCounter = document.getElementById('step-counter');
const elExerciseName = document.getElementById('exercise-name');
const elNextExerciseName = document.getElementById('next-exercise-name');
const elTimerMain = document.getElementById('timer-main');
const elTimerTotal = document.getElementById('timer-total');
const elStepRing = document.getElementById('step-progress-ring');
const elIndicatorWrapper = document.getElementById('timer-indicator-wrapper');
const btnPrev = document.getElementById('btn-prev');
const btnPause = document.getElementById('btn-pause');
const btnNext = document.getElementById('btn-next');
const btnExit = document.getElementById('btn-exit');
const btnSound = document.getElementById('btn-sound');
const gifContainer = document.getElementById('gif-container');
const floatingStage = document.getElementById('floating-figure-stage');
const imgGif = document.getElementById('exercise-gif');
const outlineCanvas = document.getElementById('png-outline-canvas');
const textGif = document.getElementById('gif-text');
const readyOverlay = document.getElementById('ready-overlay');
const btnStartPlay = document.getElementById('btn-start-play');
const btnCancelPlay = document.getElementById('btn-cancel-play');
const countdownDisplay = document.getElementById('countdown-display');

// =========================================================
// MOTOR DE TRAZADO PERIMETRAL EXACTO (MOORE-NEIGHBOR)
// =========================================================
const perimeterPathCache = {};
let activePerimeterData = null;
let perimeterExtractionFailed = false;
let lastFractionRendered = 1;

function buildFallbackBoxPath(drawX, drawY, drawW, drawH, dpr) {
    const r = Math.min(20 * dpr, drawW / 4, drawH / 4);
    const pts = [];
    const stepsPerSide = 20;
    const cx = drawX + drawW / 2;
    // Empezar arriba en el centro (12 en punto) y recorrer en sentido horario
    for (let i = 0; i <= stepsPerSide; i++) {
        pts.push({ x: cx + (drawW / 2 - r) * (i / stepsPerSide), y: drawY });
    }
    for (let i = 0; i <= stepsPerSide; i++) {
        pts.push({ x: drawX + drawW, y: drawY + r + (drawH - 2 * r) * (i / stepsPerSide) });
    }
    for (let i = 0; i <= stepsPerSide; i++) {
        pts.push({ x: drawX + drawW - r - (drawW - 2 * r) * (i / stepsPerSide), y: drawY + drawH });
    }
    for (let i = 0; i <= stepsPerSide; i++) {
        pts.push({ x: drawX, y: drawY + drawH - r - (drawH - 2 * r) * (i / stepsPerSide) });
    }
    for (let i = 0; i <= stepsPerSide; i++) {
        pts.push({ x: drawX + r + (cx - (drawX + r)) * (i / stepsPerSide), y: drawY });
    }
    const cumLengths = [0];
    let totalLength = 0;
    for (let i = 1; i < pts.length; i++) {
        totalLength += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        cumLengths.push(totalLength);
    }
    return { points: pts, cumLengths, totalLength, dpr };
}

function extractOrderedPerimeterPath(imgEl) {
    const src = imgEl.getAttribute('src');
    if (!src || !imgEl.complete || imgEl.naturalWidth === 0) return null;

    const stageW = floatingStage.offsetWidth;
    const stageH = floatingStage.offsetHeight;
    if (stageW === 0 || stageH === 0) return null;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(stageW * dpr));
    const h = Math.max(1, Math.round(stageH * dpr));
    const cacheKey = `${src}_${w}x${h}`;

    if (perimeterPathCache[cacheKey]) {
        return perimeterPathCache[cacheKey];
    }

    // Margen de 8px exacto idéntico al inset: 8px de CSS en .floating-figure-stage img
    const pad = 8 * dpr;
    const availW = Math.max(1, w - pad * 2);
    const availH = Math.max(1, h - pad * 2);

    const imgRatio = imgEl.naturalWidth / imgEl.naturalHeight;
    const boxRatio = availW / availH;
    let drawW, drawH, drawX, drawY;
    if (imgRatio > boxRatio) {
        drawW = availW;
        drawH = availW / imgRatio;
        drawX = pad;
        drawY = pad + (availH - drawH) / 2;
    } else {
        drawH = availH;
        drawW = availH * imgRatio;
        drawX = pad + (availW - drawW) / 2;
        drawY = pad;
    }

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = w;
    tempCanvas.height = h;
    const tCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
    tCtx.drawImage(imgEl, drawX, drawY, drawW, drawH);

    let imgData;
    try {
        imgData = tCtx.getImageData(0, 0, w, h).data;
    } catch (_) {
        // Fallback seguro si se abre mediante protocolo file:// con restricción CORS
        const fallback = buildFallbackBoxPath(drawX, drawY, drawW, drawH, dpr);
        perimeterPathCache[cacheKey] = fallback;
        return fallback;
    }

    const alphaMap = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
        if (imgData[i * 4 + 3] > 70) {
            alphaMap[i] = 1;
        }
    }

    const isOpaque = (x, y) => {
        if (x < 0 || y < 0 || x >= w || y >= h) return false;
        return alphaMap[y * w + x] === 1;
    };

    // 8 vecinos en sentido horario (Moore-Neighbor)
    const dirs = [
        [0, -1],  // 0: N
        [1, -1],  // 1: NE
        [1, 0],   // 2: E
        [1, 1],   // 3: SE
        [0, 1],   // 4: S
        [-1, 1],  // 5: SW
        [-1, 0],  // 6: W
        [-1, -1]  // 7: NW
    ];

    const centerX = Math.floor(w / 2);
    let rawPoints = [];

    // Buscar la silueta principal ignorando posibles motas sueltas superiores
    for (let attempt = 0; attempt < 5; attempt++) {
        let startX = -1, startY = -1;
        outerLoop:
        for (let y = 0; y < h; y++) {
            for (let offset = 0; offset <= centerX; offset++) {
                const xRight = centerX + offset;
                if (xRight < w && isOpaque(xRight, y)) {
                    startX = xRight;
                    startY = y;
                    break outerLoop;
                }
                const xLeft = centerX - offset;
                if (xLeft >= 0 && isOpaque(xLeft, y)) {
                    startX = xLeft;
                    startY = y;
                    break outerLoop;
                }
            }
        }

        if (startX === -1) break;

        rawPoints = [];
        let cx = startX;
        let cy = startY;
        let backtrackDir = 0; // El píxel superior (Norte) está garantizado vacío
        const maxSteps = w * h;
        let steps = 0;

        do {
            rawPoints.push({ x: cx + 0.5, y: cy + 0.5 });
            let foundNext = false;
            const startSearch = (backtrackDir + 1) % 8;
            for (let i = 0; i < 8; i++) {
                const dirIdx = (startSearch + i) % 8;
                const nx = cx + dirs[dirIdx][0];
                const ny = cy + dirs[dirIdx][1];
                if (isOpaque(nx, ny)) {
                    // Retroceso exacto al último píxel transparente verificado
                    backtrackDir = (dirIdx % 2 === 0) ? (dirIdx + 6) % 8 : (dirIdx + 5) % 8;
                    cx = nx;
                    cy = ny;
                    foundNext = true;
                    break;
                }
            }
            if (!foundNext) break;
            steps++;
        } while ((cx !== startX || cy !== startY || steps < 25) && steps < maxSteps);

        if (rawPoints.length >= 45) {
            break; // Silueta principal encontrada
        } else {
            // Limpiar mota pequeña aislada y volver a buscar
            rawPoints.forEach(pt => {
                const px = Math.floor(pt.x);
                const py = Math.floor(pt.y);
                for (let dy = -2; dy <= 2; dy++) {
                    for (let dx = -2; dx <= 2; dx++) {
                        const nx = px + dx, ny = py + dy;
                        if (nx >= 0 && ny >= 0 && nx < w && ny < h) {
                            alphaMap[ny * w + nx] = 0;
                        }
                    }
                }
            });
        }
    }

    if (rawPoints.length < 20) return null;

    // Submuestreo y suavizado ligero que preserva la posición 1:1 del borde
    const sampleStep = Math.max(1, Math.round(1.5 * dpr));
    const sampled = [];
    for (let i = 0; i < rawPoints.length; i += sampleStep) {
        sampled.push(rawPoints[i]);
    }

    const smoothed = [];
    const n = sampled.length;
    for (let i = 0; i < n; i++) {
        const pPrev = sampled[(i - 1 + n) % n];
        const pCurr = sampled[i];
        const pNext = sampled[(i + 1) % n];
        smoothed.push({
            x: (pPrev.x + pCurr.x * 2 + pNext.x) / 4,
            y: (pPrev.y + pCurr.y * 2 + pNext.y) / 4
        });
    }

    // Cerrar el circuito en el punto inicial
    smoothed.push({ x: smoothed[0].x, y: smoothed[0].y });

    const cumLengths = [0];
    let totalLength = 0;
    for (let i = 1; i < smoothed.length; i++) {
        const dist = Math.hypot(smoothed[i].x - smoothed[i - 1].x, smoothed[i].y - smoothed[i - 1].y);
        totalLength += dist;
        cumLengths.push(totalLength);
    }

    const result = { points: smoothed, cumLengths, totalLength, dpr, w, h };
    perimeterPathCache[cacheKey] = result;
    return result;
}

function renderPngDynamicOutline(fractionRemaining) {
    lastFractionRendered = fractionRemaining;
    const stageW = floatingStage.offsetWidth;
    const stageH = floatingStage.offsetHeight;
    if (stageW === 0 || stageH === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(stageW * dpr);
    const h = Math.round(stageH * dpr);

    if (outlineCanvas.width !== w || outlineCanvas.height !== h) {
        outlineCanvas.width = w;
        outlineCanvas.height = h;
    }

    const ctx = outlineCanvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    if (!activePerimeterData && !perimeterExtractionFailed) {
        activePerimeterData = extractOrderedPerimeterPath(imgGif);
        if (!activePerimeterData && imgGif.complete && imgGif.naturalWidth > 0) {
            perimeterExtractionFailed = true;
        }
    }
    if (!activePerimeterData) return;

    const { points, cumLengths, totalLength } = activePerimeterData;
    const isRest = currentRoutine[currentStepIndex]?.isRest;
    const lineWidth = Math.max(2.5, 3 * dpr);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = lineWidth;

    // 1. Guía perimetral tenue alrededor de la figura
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.stroke();

    // 2. Línea activa continua sincronizada con el temporizador
    const clamped = Math.max(0, Math.min(1, fractionRemaining));
    const targetLength = totalLength * clamped;

    if (targetLength > 0.5) {
        const grad = ctx.createLinearGradient(0, 0, w, h);
        if (isRest) {
            grad.addColorStop(0, '#FF9500');
            grad.addColorStop(1, '#FF2D55');
        } else {
            grad.addColorStop(0, '#00F2FE');
            grad.addColorStop(1, '#0A84FF');
        }

        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);

        let tipX = points[0].x;
        let tipY = points[0].y;

        for (let i = 1; i < points.length; i++) {
            if (cumLengths[i] <= targetLength) {
                ctx.lineTo(points[i].x, points[i].y);
                tipX = points[i].x;
                tipY = points[i].y;
            } else {
                const segStart = cumLengths[i - 1];
                const segLen = cumLengths[i] - segStart;
                const t = segLen > 0 ? (targetLength - segStart) / segLen : 0;
                tipX = points[i - 1].x + (points[i].x - points[i - 1].x) * t;
                tipY = points[i - 1].y + (points[i].y - points[i - 1].y) * t;
                ctx.lineTo(tipX, tipY);
                break;
            }
        }

        ctx.strokeStyle = grad;
        ctx.stroke();

        // Punto blanco luminoso en la punta de avance
        if (clamped < 0.995) {
            ctx.beginPath();
            ctx.arc(tipX, tipY, lineWidth * 0.7, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
        }
    }
}

window.addEventListener('resize', () => {
    activePerimeterData = null;
    perimeterExtractionFailed = false;
    if (floatingStage.style.display === 'flex') {
        renderPngDynamicOutline(lastFractionRendered);
    }
});

function initApp() {
    document.body.className = 'bg-default';
    preloadAllImages();

    workoutsData.forEach((workout, index) => {
        const card = document.createElement('div');
        card.className = 'workout-card';
        card.innerHTML = `
            <div class="workout-title">${workout.title}</div>
            <div class="workout-meta">${workout.description}</div>
            <button class="btn" data-index="${index}">Seleccionar</button>
        `;
        listContainer.appendChild(card);
    });

    document.querySelectorAll('.workout-card .btn').forEach(button => {
        button.addEventListener('click', (e) => {
            initAudio(); 
            prepareWorkout(e.target.getAttribute('data-index'));
        });
    });

    btnPrev.addEventListener('click', prevStep);
    btnPause.addEventListener('click', togglePause);
    btnNext.addEventListener('click', skipStep);
    btnExit.addEventListener('click', endWorkout);
    btnCancelPlay.addEventListener('click', endWorkout);
    
    btnStartPlay.addEventListener('click', () => {
        initAudio();
        requestWakeLock();
        btnStartPlay.style.display = 'none';
        btnCancelPlay.style.display = 'none';
        countdownDisplay.style.display = 'block';

        let count = 3;
        countdownDisplay.innerText = count;
        countdownDisplay.style.animation = 'none';
        void countdownDisplay.offsetWidth; 
        countdownDisplay.style.animation = 'popCount 1s infinite';
        playBeep('countdown'); 

        prestartInterval = setInterval(() => {
            count--;
            if (count > 0) {
                countdownDisplay.innerText = count;
                playBeep('countdown'); 
            } else {
                clearInterval(prestartInterval);
                readyOverlay.style.display = 'none';
                loadStep(currentStepIndex, 'next'); 
                startSmoothLoop();
            }
        }, 1000);
    });

    btnSound.addEventListener('click', () => {
        isSoundEnabled = !isSoundEnabled;
        btnSound.innerText = isSoundEnabled ? "🔊 Sonido ON" : "🔇 Sonido OFF";
        btnSound.classList.toggle('off', !isSoundEnabled);
        if (isSoundEnabled) initAudio();
    });
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function calculateTotalTime() {
    return currentRoutine.reduce((total, step) => total + step.duration, 0);
}

function calculateFutureTimeAfter(stepIndex) {
    let total = 0;
    for (let i = stepIndex + 1; i < currentRoutine.length; i++) {
        total += currentRoutine[i].duration;
    }
    return total;
}

function getExerciseCounterText(stepIndex) {
    const totalExercises = currentRoutine.filter(step => !step.isRest).length;
    let currentExerciseNum = 0;
    for (let i = 0; i <= stepIndex && i < currentRoutine.length; i++) {
        if (!currentRoutine[i].isRest) {
            currentExerciseNum++;
        }
    }
    if (currentExerciseNum === 0) currentExerciseNum = 1;
    return `Ejercicio ${currentExerciseNum} / ${totalExercises}`;
}

function updateNextExercisePreview(fromIndex) {
    let nextExercise = null;
    for (let i = fromIndex + 1; i < currentRoutine.length; i++) {
        if (!currentRoutine[i].isRest) {
            nextExercise = currentRoutine[i];
            break;
        }
    }
    if (nextExercise) {
        elNextExerciseName.innerText = `${nextExercise.name} (${nextExercise.duration}s)`;
    } else {
        elNextExerciseName.innerText = "¡Último ejercicio!";
    }
}

function drawSegments() {
    const container = document.getElementById('timer-segments');
    container.innerHTML = '';
    let accumulated = 0;
    const capGap = currentRoutine.length > 1 ? 12 : 0;
    
    currentRoutine.forEach((step, idx) => {
        const length = (step.duration / totalWorkoutTime) * OUTER_C;
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', '110');
        circle.setAttribute('cy', '110');
        circle.setAttribute('r', OUTER_R);
        circle.setAttribute('fill', 'none');
        circle.setAttribute('class', 'segment-arc');
        circle.setAttribute('id', `seg-${idx}`);
        circle.setAttribute('stroke', step.isRest ? 'url(#grad-rest)' : 'url(#grad-active)');
        circle.setAttribute('stroke-width', '10');
        circle.setAttribute('stroke-linecap', 'round');
        
        const visibleLength = Math.max(1.5, length - capGap);
        const startOffset = accumulated + (capGap / 2);
        
        circle.setAttribute('stroke-dasharray', `${visibleLength} ${OUTER_C}`);
        circle.setAttribute('stroke-dashoffset', -startOffset);
        
        container.appendChild(circle);
        accumulated += length;
    });

    elIndicatorWrapper.style.transform = `rotate(0deg)`;
    elStepRing.style.strokeDashoffset = 0;
}

function highlightSegments(activeIndex) {
    currentRoutine.forEach((_, idx) => {
        const seg = document.getElementById(`seg-${idx}`);
        if (!seg) return;
        if (idx < activeIndex) {
            seg.style.opacity = '0.2';
        } else if (idx === activeIndex) {
            seg.style.opacity = '1';
        } else {
            seg.style.opacity = '0.55';
        }
    });
}

function prepareWorkout(index) {
    if (finishTimeoutId) {
        clearTimeout(finishTimeoutId);
        finishTimeoutId = null;
    }

    const workout = workoutsData[index];
    currentRoutine = workout.routine;
    elWorkoutTitle.innerText = workout.title;

    screenSelector.classList.remove('active');
    screenWorkout.classList.add('active');
    document.body.className = 'bg-default'; 

    currentStepIndex = 0;
    totalWorkoutTime = calculateTotalTime();
    isPaused = false;
    btnPause.innerText = "Pausar";
    
    elStepCounter.innerText = getExerciseCounterText(0);
    elExerciseName.innerText = "¡Prepárate!";
    elTimerMain.innerText = currentRoutine[0].duration;
    elTimerMain.classList.remove('rest');
    elTimerTotal.innerText = formatTime(totalWorkoutTime);
    
    elNextExerciseName.innerText = `${currentRoutine[0].name} (${currentRoutine[0].duration}s)`;

    gifContainer.querySelectorAll('.slide-out-left, .slide-out-right').forEach(el => el.remove());
    floatingStage.classList.remove('slide-in-right', 'slide-in-left');
    floatingStage.style.display = "none";
    imgGif.removeAttribute('src');
    activePerimeterData = null;
    perimeterExtractionFailed = false;
    textGif.style.display = "block";
    textGif.innerHTML = "Pulsa Play cuando estés listo";

    readyOverlay.style.display = 'flex';
    btnStartPlay.style.display = 'block';
    btnCancelPlay.style.display = 'block';
    countdownDisplay.style.display = 'none';

    drawSegments(); 
    highlightSegments(0);

    stopSmoothLoop();
    if (prestartInterval) clearInterval(prestartInterval);
}

function loadStep(index, direction = 'next') {
    if (index >= currentRoutine.length) {
        finishWorkout();
        return;
    }

    const step = currentRoutine[index];
    currentStepDuration = step.duration;
    futureStepsTime = calculateFutureTimeAfter(index);
    
    // Actualizar números y UI del contador de forma instantánea
    lastDisplayedSecond = step.duration;
    elTimerMain.innerText = step.duration;
    elTimerTotal.innerText = formatTime(futureStepsTime + step.duration);
    elExerciseName.innerText = step.name;
    elStepCounter.innerText = getExerciseCounterText(index);
    updateNextExercisePreview(index);
    highlightSegments(index);
    
    playBeep('start');

    // 1. Clonar la figura saliente ANTES de cambiar los estilos de color del paso nuevo
    gifContainer.querySelectorAll('.slide-out-left, .slide-out-right').forEach(el => el.remove());

    if (floatingStage.style.display === "flex" && imgGif.getAttribute('src')) {
        const outgoingStage = document.createElement('div');
        const outClass = direction === 'prev' ? 'slide-out-right' : 'slide-out-left';
        outgoingStage.className = `floating-figure-stage ${outClass}`;
        outgoingStage.style.display = 'flex';
        
        const outgoingImg = imgGif.cloneNode(true);
        outgoingImg.removeAttribute('id');
        outgoingStage.appendChild(outgoingImg);

        const outgoingCanvas = document.createElement('canvas');
        outgoingCanvas.className = outlineCanvas.className;
        outgoingCanvas.width = outlineCanvas.width;
        outgoingCanvas.height = outlineCanvas.height;
        outgoingCanvas.getContext('2d').drawImage(outlineCanvas, 0, 0);
        outgoingStage.appendChild(outgoingCanvas);

        gifContainer.appendChild(outgoingStage);
        outgoingStage.addEventListener('animationend', () => outgoingStage.remove());
    }

    // 2. Aplicar el modo visual del nuevo paso
    if (step.isRest) {
        elTimerMain.classList.add('rest');
        elStepRing.setAttribute('stroke', 'url(#grad-rest)');
        outlineCanvas.classList.add('rest-mode');
        document.body.className = 'bg-rest';
    } else {
        elTimerMain.classList.remove('rest');
        elStepRing.setAttribute('stroke', 'url(#grad-active)');
        outlineCanvas.classList.remove('rest-mode');
        document.body.className = 'bg-active';
    }

    // 3. Cargar la nueva figura flotante y su contorno perimetral
    activePerimeterData = null;
    perimeterExtractionFailed = false;
    const inClass = direction === 'prev' ? 'slide-in-left' : 'slide-in-right';

    if (step.png && step.png !== "") {
        floatingStage.classList.remove('slide-in-right', 'slide-in-left');
        floatingStage.style.display = "flex";
        textGif.style.display = "none";

        imgGif.onload = () => {
            activePerimeterData = extractOrderedPerimeterPath(imgGif);
            renderPngDynamicOutline(lastFractionRendered);
        };

        imgGif.onerror = () => {
            floatingStage.style.display = "none";
            const ctx = outlineCanvas.getContext('2d');
            ctx.clearRect(0, 0, outlineCanvas.width, outlineCanvas.height);
            textGif.style.display = "block";
            textGif.innerHTML = step.isRest ? "Toma un respiro" : `Ilustración pendiente<br><small style="opacity:0.65">${step.png}</small>`;
        };

        imgGif.src = step.png;
        
        if (imgGif.complete && imgGif.naturalWidth > 0) {
            activePerimeterData = extractOrderedPerimeterPath(imgGif);
            renderPngDynamicOutline(1);
        }

        void floatingStage.offsetWidth;
        floatingStage.classList.add(inClass);
    } else {
        floatingStage.classList.remove('slide-in-right', 'slide-in-left');
        floatingStage.style.display = "none";
        imgGif.removeAttribute('src');
        textGif.style.display = "block";
        textGif.innerHTML = step.isRest ? "Toma un respiro" : "Imagen<br>(Sin archivo asignado)";
    }

    stepEndTimestamp = performance.now() + (step.duration * 1000);
    renderContinuousFrame(step.duration * 1000);
}

// Bucle fluido a máxima tasa de refresco (reloj automático sin interrupción entre pasos)
function startSmoothLoop() {
    stopSmoothLoop();
    function tick(now) {
        if (!isPaused) {
            const remainingMs = stepEndTimestamp - now;
            if (remainingMs <= 0) {
                currentStepIndex++;
                if (currentStepIndex >= currentRoutine.length) {
                    finishWorkout();
                    return;
                }
                loadStep(currentStepIndex, 'next');
            } else {
                renderContinuousFrame(remainingMs);
            }
        }
        animFrameId = requestAnimationFrame(tick);
    }
    animFrameId = requestAnimationFrame(tick);
}

function stopSmoothLoop() {
    if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
    }
}

function renderContinuousFrame(remainingMs) {
    const remainingSecFloat = Math.max(0, remainingMs / 1000);
    const displaySecond = Math.ceil(remainingSecFloat);
    const totalRemainingSecFloat = futureStepsTime + remainingSecFloat;

    if (displaySecond !== lastDisplayedSecond) {
        lastDisplayedSecond = displaySecond;
        elTimerMain.innerText = displaySecond;
        elTimerTotal.innerText = formatTime(Math.ceil(totalRemainingSecFloat));

        if (displaySecond < currentStepDuration && displaySecond > 0) {
            elTimerMain.style.transform = 'scale(1.05)';
            setTimeout(() => elTimerMain.style.transform = 'scale(1)', 100);
        }

        if (displaySecond > 0 && displaySecond <= 3) {
            playBeep('countdown');
        }
    }

    if (totalWorkoutTime > 0) {
        const elapsedTotalFloat = totalWorkoutTime - totalRemainingSecFloat;
        const angle = (elapsedTotalFloat / totalWorkoutTime) * 360;
        elIndicatorWrapper.style.transform = `rotate(${angle}deg)`;
    }

    if (currentStepDuration > 0) {
        const fractionRemaining = remainingSecFloat / currentStepDuration;
        const offset = INNER_C * (1 - fractionRemaining);
        elStepRing.style.strokeDashoffset = offset;

        renderPngDynamicOutline(fractionRemaining);
    }
}

function togglePause() {
    isPaused = !isPaused;
    btnPause.innerText = isPaused ? "Reanudar" : "Pausar";
    
    if (isPaused) {
        pausedRemainingMs = Math.max(0, stepEndTimestamp - performance.now());
        document.body.className = 'bg-default';
        releaseWakeLock();
    } else {
        stepEndTimestamp = performance.now() + pausedRemainingMs;
        const step = currentRoutine[currentStepIndex];
        document.body.className = step.isRest ? 'bg-rest' : 'bg-active';
        requestWakeLock();
    }
}

function prevStep() {
    if (currentRoutine.length === 0) return;

    if (isPaused) {
        isPaused = false;
        btnPause.innerText = "Pausar";
        requestWakeLock();
    }

    if (currentStepIndex > 0) {
        currentStepIndex--;
    } else {
        currentStepIndex = 0;
    }
    loadStep(currentStepIndex, 'prev');
    if (!animFrameId) startSmoothLoop();
}

function skipStep() {
    if (currentStepIndex >= currentRoutine.length) return;
    
    if (isPaused) {
        isPaused = false;
        btnPause.innerText = "Pausar";
        requestWakeLock();
    }
    
    currentStepIndex++;
    if (currentStepIndex >= currentRoutine.length) {
        finishWorkout();
        return;
    }
    loadStep(currentStepIndex, 'next');
    if (!animFrameId) startSmoothLoop();
}

function endWorkout() {
    stopSmoothLoop();
    releaseWakeLock();
    if (prestartInterval) clearInterval(prestartInterval);
    if (finishTimeoutId) {
        clearTimeout(finishTimeoutId);
        finishTimeoutId = null;
    }
    screenWorkout.classList.remove('active');
    screenSelector.classList.add('active');
    document.body.className = 'bg-default';
}

function finishWorkout() {
    stopSmoothLoop();
    releaseWakeLock();
    elExerciseName.innerText = "¡Completado!";
    elNextExerciseName.innerText = "Entrenamiento finalizado";
    elTimerMain.innerText = "0";
    elTimerTotal.innerText = "00:00";
    document.body.className = 'bg-default';
    
    highlightSegments(currentRoutine.length);
    elStepRing.style.strokeDashoffset = INNER_C;
    renderPngDynamicOutline(0);
    
    playBeep('start');
    finishTimeoutId = setTimeout(() => {
        endWorkout();
    }, 3000);
}

document.addEventListener('DOMContentLoaded', initApp);
