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
let totalTimeRemaining = 0;
let totalWorkoutTime = 0;
let timerInterval = null;
let prestartInterval = null;
let isPaused = false;

const screenSelector = document.getElementById('screen-selector');
const screenWorkout = document.getElementById('screen-workout');
const listContainer = document.getElementById('workout-list');
const elWorkoutTitle = document.getElementById('current-workout-title');
const elExerciseName = document.getElementById('exercise-name');
const elTimerMain = document.getElementById('timer-main');
const elTimerTotal = document.getElementById('timer-total');
const btnPause = document.getElementById('btn-pause');
const btnNext = document.getElementById('btn-next'); // NUEVO BOTÓN
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
    btnNext.addEventListener('click', skipStep); // NUEVO EVENTO
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

function drawSegments() {
    const container = document.getElementById('timer-segments');
    container.innerHTML = '';
    const C = 2 * Math.PI * 45; 
    let accumulated = 0;
    
    currentRoutine.forEach(step => {
        const length = (step.duration / totalWorkoutTime) * C;
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', '50');
        circle.setAttribute('cy', '50');
        circle.setAttribute('r', '45');
        circle.setAttribute('fill', 'none');
        circle.setAttribute('stroke', step.isRest ? '#FF453A' : '#0A84FF');
        circle.setAttribute('stroke-width', '6');
        
        const visibleLength = Math.max(0.1, length - 1);
        
        circle.setAttribute('stroke-dasharray', `${visibleLength} ${C}`);
        circle.setAttribute('stroke-dashoffset', -accumulated);
        
        container.appendChild(circle);
        accumulated += length;
    });

    document.getElementById('timer-progress-shadow').style.strokeDashoffset = C;
    document.getElementById('timer-indicator-wrapper').style.transform = `rotate(0deg)`;
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
    
    elExerciseName.innerText = "¡Prepárate!";
    elTimerMain.innerText = "00";
    elTimerMain.classList.remove('rest');
    elTimerTotal.innerText = formatTime(totalTimeRemaining);
    imgGif.style.display = "none";
    textGif.style.display = "block";
    textGif.innerHTML = "Pulsa Play cuando estés listo";

    readyOverlay.style.display = 'flex';
    btnStartPlay.style.display = 'block';
    btnCancelPlay.style.display = 'block';
    countdownDisplay.style.display = 'none';

    drawSegments(); 

    if (timerInterval) clearInterval(timerInterval);
    if (prestartInterval) clearInterval(prestartInterval);
}

function loadStep(index) {
    if (index >= currentRoutine.length) {
        finishWorkout();
        return;
    }

    const step = currentRoutine[index];
    timeRemainingInStep = step.duration;
    elExerciseName.innerText = step.name;
    
    playBeep('start');
    
    if (step.isRest) {
        elTimerMain.classList.add('rest');
        document.body.className = 'bg-rest';
    } else {
        elTimerMain.classList.remove('rest');
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
        const C = 2 * Math.PI * 45; 
        const elapsedLength = (elapsed / totalWorkoutTime) * C;
        const angle = (elapsed / totalWorkoutTime) * 360;
        
        document.getElementById('timer-progress-shadow').style.strokeDashoffset = C - elapsedLength;
        document.getElementById('timer-indicator-wrapper').style.transform = `rotate(${angle}deg)`;
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

// NUEVA FUNCIÓN: Saltar al siguiente paso
function skipStep() {
    // Evita errores si le das a saltar cuando ya ha terminado
    if (currentStepIndex >= currentRoutine.length) return;
    
    // Restar el tiempo que quedaba de golpe para que el reloj general avance
    totalTimeRemaining -= timeRemainingInStep;
    
    // Si estaba pausado, lo reanudamos automáticamente al saltar
    if (isPaused) {
        isPaused = false;
        btnPause.innerText = "Pausar";
    }
    
    // Pasamos al siguiente
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
    elTimerMain.innerText = "0";
    elTimerTotal.innerText = "00:00";
    document.body.className = 'bg-default';
    
    document.getElementById('timer-progress-shadow').style.strokeDashoffset = 0;
    
    playBeep('start');
    setTimeout(() => {
        endWorkout();
    }, 3000);
}

document.addEventListener('DOMContentLoaded', initApp);
