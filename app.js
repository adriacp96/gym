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
const OUTER_C = 2 * Math.PI * OUTER_R; // 603.185
const INNER_R = 78;
const INNER_C = 2 * Math.PI * INNER_R; // 490.088

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
const btnPause = document.getElementById('btn-pause');
const btnNext = document.getElementById('btn-next');
const btnExit = document.getElementById('btn-exit');
const btnSound = document.getElementById('btn-sound');
const imgGif = document.getElementById('exercise-gif');
const textGif = document.getElementById('gif-text');
const readyOverlay = document.getElementById('ready-overlay');
const btnStartPlay = document.getElementById('btn-start-play');
const btnCancelPlay = document.getElementById('btn-cancel-play');
const countdownDisplay = document.getElementById('countdown-display');

function initApp() {
    document.body.className = 'bg-default';
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

// Cuenta únicamente los ejercicios reales (ignora los descansos)
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

// Busca el próximo ejercicio real (saltándose los descansos)
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

// Dibuja el anillo exterior con el mismo diseño moderno (grosor 10, bordes redondeados y gradiente)
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
    
    // Al estar en preparación, el "Siguiente" es el primer ejercicio
    elNextExerciseName.innerText = `${currentRoutine[0].name} (${currentRoutine[0].duration}s)`;

    imgGif.style.display = "none";
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
    
    elExerciseName.innerText = step.name;
    elStepCounter.innerText = getExerciseCounterText(index);
    updateNextExercisePreview(index);
    highlightSegments(index);
    
    playBeep('start');
    
    if (step.isRest) {
        elTimerMain.classList.add('rest');
        elStepRing.setAttribute('stroke', 'url(#grad-rest)');
        document.body.className = 'bg-rest';
    } else {
        elTimerMain.classList.remove('rest');
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
        textGif.style.display = "block";
        textGif.innerHTML = step.isRest ? "Toma un respiro" : "GIF / Video<br>(Sin archivo asignado)";
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
    elExerciseName.innerText = "¡Completado!";
    elNextExerciseName.innerText = "Entrenamiento finalizado";
    elTimerMain.innerText = "0";
    elTimerTotal.innerText = "00:00";
    document.body.className = 'bg-default';
    
    highlightSegments(currentRoutine.length);
    elStepRing.style.strokeDashoffset = 0;
    
    playBeep('start');
    setTimeout(() => {
        endWorkout();
    }, 3000);
}

document.addEventListener('DOMContentLoaded', initApp);
