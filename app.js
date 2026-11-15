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
let timeRemainingInStep = 0;
let currentStepDuration = 1;
let totalTimeRemaining = 0;
let totalWorkoutTime = 0;
let timerInterval = null;
let prestartInterval = null;
let isPaused = false;

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
// MOTOR DE SILUETA LUMINOSA DINÁMICA PARA PNG EN CANVAS
// =========================================================
const silhouetteMaskCache = {};
let activeSilhouetteMask = null;
let lastFractionRendered = 1;

function getSilhouetteOutlineMask(imgEl) {
    const src = imgEl.getAttribute('src');
    if (!src || !imgEl.complete || imgEl.naturalWidth === 0) return null;

    const rect = floatingStage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    const cacheKey = `${src}_${w}x${h}`;

    if (silhouetteMaskCache[cacheKey]) {
        return silhouetteMaskCache[cacheKey];
    }

    // Calcular encaje exacto (object-fit: contain)
    const imgRatio = imgEl.naturalWidth / imgEl.naturalHeight;
    const boxRatio = w / h;
    let drawW, drawH, drawX, drawY;
    if (imgRatio > boxRatio) {
        drawW = w;
        drawH = w / imgRatio;
        drawX = 0;
        drawY = (h - drawH) / 2;
    } else {
        drawH = h;
        drawW = h * imgRatio;
        drawX = (w - drawW) / 2;
        drawY = 0;
    }

    const strokeThickness = Math.max(2.5, 3 * dpr);

    // 1. Generar silueta expandida mediante sombras radiales en 16 direcciones
    const expandedCanvas = document.createElement('canvas');
    expandedCanvas.width = w;
    expandedCanvas.height = h;
    const eCtx = expandedCanvas.getContext('2d');

    const steps = 16;
    for (let i = 0; i < steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        const ox = Math.cos(angle) * strokeThickness;
        const oy = Math.sin(angle) * strokeThickness;
        eCtx.drawImage(imgEl, drawX + ox, drawY + oy, drawW, drawH);
    }

    // 2. Restar la imagen original del centro para dejar solo el borde exterior exacto
    eCtx.globalCompositeOperation = 'destination-out';
    eCtx.drawImage(imgEl, drawX, drawY, drawW, drawH);

    // 3. Convertir a máscara blanca sólida
    eCtx.globalCompositeOperation = 'source-in';
    eCtx.fillStyle = '#ffffff';
    eCtx.fillRect(0, 0, w, h);

    silhouetteMaskCache[cacheKey] = expandedCanvas;
    return expandedCanvas;
}

function renderPngDynamicOutline(fractionRemaining) {
    lastFractionRendered = fractionRemaining;
    const rect = floatingStage.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);

    if (outlineCanvas.width !== w || outlineCanvas.height !== h) {
        outlineCanvas.width = w;
        outlineCanvas.height = h;
    }

    const ctx = outlineCanvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    if (!activeSilhouetteMask) {
        activeSilhouetteMask = getSilhouetteOutlineMask(imgGif);
    }
    if (!activeSilhouetteMask) return;

    const isRest = currentRoutine[currentStepIndex]?.isRest;

    // 1. Contorno base tenue (mismo estilo que el anillo de fondo rgba(255,255,255,0.12))
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.drawImage(activeSilhouetteMask, 0, 0, w, h);
    ctx.restore();

    // 2. Contorno de color activo sincronizado con el tiempo restante
    const clamped = Math.max(0, Math.min(1, fractionRemaining));
    if (clamped > 0) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = w;
        tempCanvas.height = h;
        const tCtx = tempCanvas.getContext('2d');

        // Degradado idéntico al del contador circular
        const grad = tCtx.createLinearGradient(0, 0, w, h);
        if (isRest) {
            grad.addColorStop(0, '#FF9500');
            grad.addColorStop(1, '#FF2D55');
        } else {
            grad.addColorStop(0, '#00F2FE');
            grad.addColorStop(1, '#0A84FF');
        }

        // Recorte angular que avanza en el sentido de las agujas del reloj desde las 12 en punto
        const cx = w / 2;
        const cy = h / 2;
        const radius = Math.hypot(w, h);
        const startAngle = -Math.PI / 2;
        const endAngle = startAngle + clamped * Math.PI * 2;

        tCtx.beginPath();
        tCtx.moveTo(cx, cy);
        tCtx.arc(cx, cy, radius, startAngle, endAngle, false);
        tCtx.closePath();
        tCtx.fillStyle = grad;
        tCtx.fill();

        // Aplicar el sector coloreado únicamente sobre la silueta del personaje
        tCtx.globalCompositeOperation = 'destination-in';
        tCtx.drawImage(activeSilhouetteMask, 0, 0, w, h);

        ctx.drawImage(tempCanvas, 0, 0);
    }
}

window.addEventListener('resize', () => {
    activeSilhouetteMask = null;
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
                loadStep(currentStepIndex); 
                timerInterval = setInterval(updateTimer, 1000);
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

function calculateRemainingFromIndex(startIndex) {
    let total = 0;
    for (let i = startIndex; i < currentRoutine.length; i++) {
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
    const workout = workoutsData[index];
    currentRoutine = workout.routine;
    elWorkoutTitle.innerText = workout.title;

    screenSelector.classList.remove('active');
    screenWorkout.classList.add('active');
    document.body.className = 'bg-default'; 

    currentStepIndex = 0;
    totalWorkoutTime = calculateTotalTime();
    totalTimeRemaining = totalWorkoutTime;
    isPaused = false;
    btnPause.innerText = "Pausar";
    
    elStepCounter.innerText = getExerciseCounterText(0);
    elExerciseName.innerText = "¡Prepárate!";
    elTimerMain.innerText = currentRoutine[0].duration;
    elTimerMain.classList.remove('rest');
    elTimerTotal.innerText = formatTime(totalTimeRemaining);
    
    elNextExerciseName.innerText = `${currentRoutine[0].name} (${currentRoutine[0].duration}s)`;

    gifContainer.querySelectorAll('.slide-out-left').forEach(el => el.remove());
    floatingStage.classList.remove('slide-in-right');
    floatingStage.style.display = "none";
    imgGif.removeAttribute('src');
    activeSilhouetteMask = null;
    textGif.style.display = "block";
    textGif.innerHTML = "Pulsa Play cuando estés listo";

    readyOverlay.style.display = 'flex';
    btnStartPlay.style.display = 'block';
    btnCancelPlay.style.display = 'block';
    countdownDisplay.style.display = 'none';

    drawSegments(); 
    highlightSegments(0);

    if (timerInterval) clearInterval(timerInterval);
    if (prestartInterval) clearInterval(prestartInterval);
}

function loadStep(index) {
    if (index >= currentRoutine.length) {
        finishWorkout();
        return;
    }

    const step = currentRoutine[index];
    currentStepDuration = step.duration;
    timeRemainingInStep = step.duration;
    totalTimeRemaining = calculateRemainingFromIndex(index);
    
    elExerciseName.innerText = step.name;
    elStepCounter.innerText = getExerciseCounterText(index);
    updateNextExercisePreview(index);
    highlightSegments(index);
    
    playBeep('start');
    
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

    // Limpiar clones anteriores
    gifContainer.querySelectorAll('.slide-out-left').forEach(el => el.remove());

    // Clonar la figura actual (imagen + contorno actual) para que salga hacia la izquierda
    if (floatingStage.style.display === "flex" && imgGif.getAttribute('src')) {
        const outgoingStage = document.createElement('div');
        outgoingStage.className = 'floating-figure-stage slide-out-left';
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

    // Mostrar la nueva figura flotante deslizándose desde la derecha
    activeSilhouetteMask = null;
    if (step.png && step.png !== "") {
        floatingStage.classList.remove('slide-in-right');
        imgGif.onload = () => {
            activeSilhouetteMask = getSilhouetteOutlineMask(imgGif);
            renderPngDynamicOutline(1);
        };
        imgGif.src = step.png;
        floatingStage.style.display = "flex";
        textGif.style.display = "none";
        
        if (imgGif.complete && imgGif.naturalWidth > 0) {
            activeSilhouetteMask = getSilhouetteOutlineMask(imgGif);
            renderPngDynamicOutline(1);
        }

        void floatingStage.offsetWidth;
        floatingStage.classList.add('slide-in-right');
    } else {
        floatingStage.classList.remove('slide-in-right');
        floatingStage.style.display = "none";
        imgGif.removeAttribute('src');
        textGif.style.display = "block";
        textGif.innerHTML = step.isRest ? "Toma un respiro" : "Imagen<br>(Sin archivo asignado)";
    }

    elStepRing.style.transition = 'none';
    elStepRing.style.strokeDashoffset = 0;
    void elStepRing.offsetWidth;
    elStepRing.style.transition = 'stroke-dashoffset 1s linear, stroke 0.4s ease';

    updateUI();
}

function updateTimer() {
    if (isPaused) return;

    if (timeRemainingInStep > 0) {
        timeRemainingInStep--;
        totalTimeRemaining--;
        updateUI();
        
        elTimerMain.style.transform = 'scale(1.05)';
        setTimeout(() => elTimerMain.style.transform = 'scale(1)', 100);

        if (timeRemainingInStep > 0 && timeRemainingInStep <= 3) {
            playBeep('countdown');
        }
    } else {
        currentStepIndex++;
        loadStep(currentStepIndex);
    }
}

function updateUI() {
    elTimerMain.innerText = timeRemainingInStep;
    elTimerTotal.innerText = formatTime(totalTimeRemaining);
    
    if (totalWorkoutTime > 0) {
        const elapsed = totalWorkoutTime - totalTimeRemaining;
        const angle = (elapsed / totalWorkoutTime) * 360;
        elIndicatorWrapper.style.transform = `rotate(${angle}deg)`;
    }

    if (currentStepDuration > 0) {
        const fractionRemaining = timeRemainingInStep / currentStepDuration;
        const offset = INNER_C * (1 - fractionRemaining);
        elStepRing.style.strokeDashoffset = offset;

        // Actualizar el contorno dinámico de la silueta en sincronía con el contador
        renderPngDynamicOutline(fractionRemaining);
    }
}

function togglePause() {
    isPaused = !isPaused;
    btnPause.innerText = isPaused ? "Reanudar" : "Pausar";
    
    if (isPaused) {
        document.body.className = 'bg-default';
    } else {
        const step = currentRoutine[currentStepIndex];
        document.body.className = step.isRest ? 'bg-rest' : 'bg-active';
    }
}

function prevStep() {
    if (currentRoutine.length === 0) return;

    if (isPaused) {
        isPaused = false;
        btnPause.innerText = "Pausar";
    }

    if (currentStepIndex > 0) {
        currentStepIndex--;
    } else {
        currentStepIndex = 0;
    }
    loadStep(currentStepIndex);
}

function skipStep() {
    if (currentStepIndex >= currentRoutine.length) return;
    
    if (isPaused) {
        isPaused = false;
        btnPause.innerText = "Pausar";
    }
    
    currentStepIndex++;
    loadStep(currentStepIndex);
}

function endWorkout() {
    if (timerInterval) clearInterval(timerInterval);
    if (prestartInterval) clearInterval(prestartInterval);
    screenWorkout.classList.remove('active');
    screenSelector.classList.add('active');
    document.body.className = 'bg-default';
}

function finishWorkout() {
    if (timerInterval) clearInterval(timerInterval);
    elExerciseName.innerText = "¡Completado!";
    elNextExerciseName.innerText = "Entrenamiento finalizado";
    elTimerMain.innerText = "0";
    elTimerTotal.innerText = "00:00";
    document.body.className = 'bg-default';
    
    highlightSegments(currentRoutine.length);
    elStepRing.style.strokeDashoffset = 0;
    renderPngDynamicOutline(0);
    
    playBeep('start');
    setTimeout(() => {
        endWorkout();
    }, 3000);
}

document.addEventListener('DOMContentLoaded', initApp);
