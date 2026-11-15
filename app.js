let currentRoutine = [];
let currentStepIndex = 0;
let timeRemainingInStep = 0;
let totalTimeRemaining = 0;
let timerInterval = null;
let isPaused = false;

// Elementos del DOM
const screenSelector = document.getElementById('screen-selector');
const screenWorkout = document.getElementById('screen-workout');
const listContainer = document.getElementById('workout-list');
const elWorkoutTitle = document.getElementById('current-workout-title');
const elExerciseName = document.getElementById('exercise-name');
const elTimerMain = document.getElementById('timer-main');
const elTimerTotal = document.getElementById('timer-total');
const btnPause = document.getElementById('btn-pause');
const btnExit = document.getElementById('btn-exit');
const imgGif = document.getElementById('exercise-gif');
const textGif = document.getElementById('gif-text');

// Inicializar la lista
function initApp() {
    workoutsData.forEach((workout, index) => {
        const card = document.createElement('div');
        card.className = 'workout-card';
        card.innerHTML = `
            <div class="workout-title">${workout.title}</div>
            <div class="workout-meta">${workout.description}</div>
            <button class="btn" data-index="${index}">Empezar</button>
        `;
        listContainer.appendChild(card);
    });

    // Añadir eventos a los botones de "Empezar"
    const startButtons = document.querySelectorAll('.workout-card .btn');
    startButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            startWorkout(e.target.getAttribute('data-index'));
        });
    });

    // Eventos de los controles
    btnPause.addEventListener('click', togglePause);
    btnExit.addEventListener('click', endWorkout);
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function calculateTotalTime() {
    return currentRoutine.reduce((total, step) => total + step.duration, 0);
}

function startWorkout(index) {
    const workout = workoutsData[index];
    currentRoutine = workout.routine;
    elWorkoutTitle.innerText = workout.title;

    screenSelector.classList.remove('active');
    screenWorkout.classList.add('active');

    currentStepIndex = 0;
    totalTimeRemaining = calculateTotalTime();
    isPaused = false;
    btnPause.innerText = "Pausar";
    
    loadStep(currentStepIndex);
    
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(updateTimer, 1000);
}

function loadStep(index) {
    if (index >= currentRoutine.length) {
        finishWorkout();
        return;
    }

    const step = currentRoutine[index];
    timeRemainingInStep = step.duration;
    elExerciseName.innerText = step.name;
    
    if (step.isRest) {
        elTimerMain.classList.add('rest');
    } else {
        elTimerMain.classList.remove('rest');
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
    } else {
        currentStepIndex++;
        loadStep(currentStepIndex);
    }
}

function updateUI() {
    elTimerMain.innerText = timeRemainingInStep;
    elTimerTotal.innerText = formatTime(totalTimeRemaining);
}

function togglePause() {
    isPaused = !isPaused;
    btnPause.innerText = isPaused ? "Reanudar" : "Pausar";
}

function endWorkout() {
    if (timerInterval) clearInterval(timerInterval);
    screenWorkout.classList.remove('active');
    screenSelector.classList.add('active');
}

function finishWorkout() {
    if (timerInterval) clearInterval(timerInterval);
    elExerciseName.innerText = "¡Completado!";
    elTimerMain.innerText = "0";
    elTimerTotal.innerText = "00:00";
    setTimeout(() => {
        endWorkout();
    }, 3000);
}

// Arrancar la aplicación
document.addEventListener('DOMContentLoaded', initApp);
