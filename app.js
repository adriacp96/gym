let isSoundEnabled = true;
let audioCtx = null;

function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
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
        oscillator.frequency.setValueAtTime(520, audioCtx.currentTime); 
        gainNode.gain.setValueAtTime(0.8, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.18);
        oscillator.start(audioCtx.currentTime);
        oscillator.stop(audioCtx.currentTime + 0.18);
    } else if (type === 'start') {
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); 
        gainNode.gain.setValueAtTime(1, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.42);
        oscillator.start(audioCtx.currentTime);
        oscillator.stop(audioCtx.currentTime + 0.42);
    }
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

// Constantes geométricas de los anillos SVG (viewBox 220x220)
const OUTER_R = 96;
const OUTER_C = 2 * Math.PI * OUTER_R; // 603.185
const INNER_R = 80;
const INNER_C = 2 * Math.PI * INNER_R; // 502.654

const screenSelector = document.getElementById('screen-selector');
const screenWorkout = document.getElementById('screen-workout');
const listContainer = document.getElementById('workout-list');
const elWorkoutTitle = document.getElementById('current-workout-title');
const elReadyWorkoutName = document.getElementById('ready-workout-name');
const elStepCounter = document.getElementById('step-counter');
const elStatePill = document.getElementById('state-pill');
const elExerciseName = document.getElementById('exercise-name');
const elTimerMain = document.getElementById('timer-main');
const elTimerTotal = document.getElementById('timer-total');
const elStepRing = document.getElementById('step-progress-ring');
const elIndicatorWrapper = document.getElementById('timer-indicator-wrapper');
const btnPause = document.getElementById('btn-pause');
const btnNext = document.getElementById('btn-next');
const btnExit = document.getElementById('btn-exit');
const btnSound = document.getElementById('btn-sound');
const imgGif = document.getElementById('exercise-gif');
const textGif = document.getElementById('gif-text');
const readyOverlay = document.getElementById('ready-overlay');
const readyCard = document.querySelector('.ready-card');
const btnStartPlay = document.getElementById('btn-start-play');
const btnCancelPlay = document.getElementById('btn-cancel-play');
const countdownDisplay = document.getElementById('countdown-display');

function initApp() {
    document.body.className = 'bg-default';
    workoutsData.forEach((workout, index) => {
        const card = document.createElement('div');
        card.className = 'workout-card';
        card.innerHTML = `
            <div>
                <div class="workout-title">${workout.title}</div>
                <div class="workout-meta">${workout.description}</div>
            </div>
            <button class="btn" data-index="${index}">Seleccionar Rutina</button>
        `;
        listContainer.appendChild(card);
    });

    document.querySelectorAll('.workout-card .btn').forEach(button => {
        button.addEventListener('click', (e) => {
            initAudio(); 
            prepareWorkout(e.target.getAttribute('data-index'));
        });
    });

    btnPause.addEventListener('click', togglePause);
    btnNext.addEventListener('click', skipStep);
    btnExit.addEventListener('click', endWorkout);
    btnCancelPlay.addEventListener('click', endWorkout);
    
    btnStartPlay.addEventListener('click', () => {
        initAudio(); 
        readyCard.style.display = 'none';
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

// Dibuja los segmentos de la rutina en el anillo exterior (r=96)
function drawSegments() {
    const container = document.getElementById('timer-segments');
    container.innerHTML = '';
    let accumulated = 0;
    
    currentRoutine.forEach((step, idx) => {
        const length = (step.duration / totalWorkoutTime) * OUTER_C;
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', '110');
        circle.setAttribute('cy', '110');
        circle.setAttribute('r', OUTER_R);
        circle.setAttribute('fill', 'none');
        circle.setAttribute('class', 'segment-arc');
        circle.setAttribute('id', `seg-${idx}`);
        circle.setAttribute('stroke', step.isRest ? '#FF2D55' : '#00F2FE');
        circle.setAttribute('stroke-width', '7');
        
        // Separación limpia entre bloques
        const gap = currentRoutine.length > 1 ? 3.5 : 0;
        const visibleLength = Math.max(1.5, length - gap);
        
        circle.setAttribute('stroke-dasharray', `${visibleLength} ${OUTER_C}`);
        circle.setAttribute('stroke-dashoffset', -accumulated);
        
        container.appendChild(circle);
        accumulated += length;
    });

    elIndicatorWrapper.style.transform = `rotate(0deg)`;
    elStepRing.style.strokeDashoffset = 0;
}

// Ilumina el segmento actual, atenúa los pasados y deja visibles los futuros
function highlightSegments(activeIndex) {
    currentRoutine.forEach((_, idx) => {
        const seg = document.getElementById(`seg-${idx}`);
        if (!seg) return;
        if (idx < activeIndex) {
            seg.style.opacity = '0.18';
            seg.setAttribute('stroke-width', '5');
        } else if (idx === activeIndex) {
            seg.style.opacity = '1';
            seg.setAttribute('stroke-width', '9');
        } else {
            seg.style.opacity = '0.55';
            seg.setAttribute('stroke-width', '7');
        }
    });
}

function prepareWorkout(index) {
    const workout = workoutsData[index];
    currentRoutine = workout.routine;
    elWorkoutTitle.innerText = workout.title;
    elReadyWorkoutName.innerText = workout.title.toUpperCase();

    screenSelector.classList.remove('active');
    screenWorkout.classList.add('active');
    document.body.className = 'bg-default'; 

    currentStepIndex = 0;
    totalWorkoutTime = calculateTotalTime();
    totalTimeRemaining = totalWorkoutTime;
    isPaused = false;
    btnPause.innerText = "Pausar";
    
    elStepCounter.innerText = `1 / ${currentRoutine.length}`;
    elStatePill.innerText = "PREPARACIÓN";
    elStatePill.classList.remove('rest');
    elExerciseName.innerText = "Listo para empezar";
    elTimerMain.innerText = currentRoutine[0].duration;
    elTimerMain.classList.remove('rest');
    elTimerTotal.innerText = formatTime(totalTimeRemaining);
    
    imgGif.style.display = "none";
    textGif.style.display = "flex";

    readyOverlay.style.display = 'flex';
    readyCard.style.display = 'flex';
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
    
    elExerciseName.innerText = step.name;
    elStepCounter.innerText = `${index + 1} / ${currentRoutine.length}`;
    highlightSegments(index);
    
    playBeep('start');
    
    if (step.isRest) {
        elTimerMain.classList.add('rest');
        elStatePill.innerText = "DESCANSO";
        elStatePill.classList.add('rest');
        elStepRing.setAttribute('stroke', 'url(#grad-rest)');
        document.body.className = 'bg-rest';
    } else {
        elTimerMain.classList.remove('rest');
        elStatePill.innerText = "EJERCICIO ACTIVO";
        elStatePill.classList.remove('rest');
        elStepRing.setAttribute('stroke', 'url(#grad-active)');
        document.body.className = 'bg-active';
    }

    if (step.gif && step.gif !== "") {
        imgGif.src = step.gif;
        imgGif.style.display = "block";
        textGif.style.display = "none";
    } else {
        imgGif.style.display = "none";
        imgGif.src = "";
        textGif.style.display = "flex";
        textGif.innerHTML = step.isRest 
            ? `<span class="pulse-icon">🧘‍♂️</span><p>Recupera el aliento</p>` 
            : `<span class="pulse-icon">⚡</span><p>Mantén la postura</p>`;
    }

    // Resetear instantáneamente el anillo interior al 100% al cambiar de ejercicio
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
        
        elTimerMain.style.transform = 'scale(1.04)';
        setTimeout(() => elTimerMain.style.transform = 'scale(1)', 120);

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
    
    // 1. Anillo exterior: Gira el punto blanco según el progreso total
    if (totalWorkoutTime > 0) {
        const elapsedTotal = totalWorkoutTime - totalTimeRemaining;
        const angle = (elapsedTotal / totalWorkoutTime) * 360;
        elIndicatorWrapper.style.transform = `rotate(${angle}deg)`;
    }

    // 2. Anillo interior: Se vacía suavemente en el ejercicio actual
    if (currentStepDuration > 0) {
        const fractionRemaining = timeRemainingInStep / currentStepDuration;
        const offset = INNER_C * (1 - fractionRemaining);
        elStepRing.style.strokeDashoffset = offset;
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

function skipStep() {
    if (currentStepIndex >= currentRoutine.length) return;
    
    totalTimeRemaining -= timeRemainingInStep;
    if (totalTimeRemaining < 0) totalTimeRemaining = 0;
    
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
    elStatePill.innerText = "FINALIZADO";
    elExerciseName.innerText = "¡Entrenamiento Completado!";
    elTimerMain.innerText = "✓";
    elTimerTotal.innerText = "00:00";
    document.body.className = 'bg-default';
    
    highlightSegments(currentRoutine.length);
    elStepRing.style.strokeDashoffset = 0;
    
    playBeep('start');
    setTimeout(() => {
        endWorkout();
    }, 3200);
}

document.addEventListener('DOMContentLoaded', initApp);
