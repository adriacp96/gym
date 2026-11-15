// --- SISTEMA DE AUDIO DEFINITIVO PARA iOS (WEB AUDIO API + CORS TTS) ---
let isSoundEnabled = true;
let isVoiceEnabled = true;
let audioCtx = null;
let keepAliveOsc = null;
let currentVoiceSource = null;

// Caché en memoria RAM para reproducir las frases al instante
const voiceBufferCache = new Map();

const motivationalPhrases = [
    "¡Vamos, tú puedes!",
    "¡Sigue así, mantén la postura!",
    "¡Lo estás haciendo genial!",
    "¡No bajes el ritmo!",
    "¡Aguanta fuerte, aprieta el abdomen!"
];

// Controla el mezclador nativo de iOS:
// 'ambient' -> música al 100% mezclada con la web
// 'transient' -> baja ligeramente la música de fondo (ducking) mientras habla sin pausarla
function setIOSAudioSession(mode) {
    if ('audioSession' in navigator) {
        try {
            navigator.audioSession.type = mode;
        } catch (e) {}
    }
}

function initAudio() {
    setIOSAudioSession('ambient');

    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    
    // Mantiene el canal de audio abierto en el iPhone durante todo el entrenamiento
    if (!keepAliveOsc && audioCtx) {
        try {
            keepAliveOsc = audioCtx.createOscillator();
            const silentGain = audioCtx.createGain();
            keepAliveOsc.frequency.value = 1;
            silentGain.gain.value = 0.00001;
            keepAliveOsc.connect(silentGain);
            silentGain.connect(audioCtx.destination);
            keepAliveOsc.start();
        } catch (e) {}
    }
}

// Convierte abreviaturas para que la voz las pronuncie completas
function formatSpeechName(name) {
    return name
        .replace(/flex\.\s*rodillas/gi, 'flexiones de rodillas')
        .replace(/flex\./gi, 'flexiones')
        .replace(/\(Izquierdo\)/gi, 'lado izquierdo')
        .replace(/\(Derecho\)/gi, 'lado derecho');
}

// Descarga el audio de voz desde servidores con CORS habilitado (*) y lo decodifica en el AudioContext
async function getVoiceBuffer(text) {
    if (voiceBufferCache.has(text)) {
        return voiceBufferCache.get(text);
    }

    initAudio();
    const encoded = encodeURIComponent(text);
    const googleUrl = `https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=es&client=tw-ob&q=${encoded}`;

    // 1. StreamElements API (Voz neural Conchita/Enrique con Access-Control-Allow-Origin: *)
    // 2. Proxy CORS de respaldo por si falla el primero
    const endpoints = [
        `https://api.streamelements.com/kappa/v2/speech?voice=Conchita&text=${encoded}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(googleUrl)}`,
        `https://corsproxy.io/?${encodeURIComponent(googleUrl)}`
    ];

    for (const url of endpoints) {
        try {
            const response = await fetch(url);
            if (!response.ok) continue;

            const arrayBuffer = await response.arrayBuffer();
            if (arrayBuffer.byteLength < 500) continue;

            // Decodificación compatible con todas las versiones de Safari iOS
            const audioBuffer = await new Promise((resolve, reject) => {
                audioCtx.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
            });

            voiceBufferCache.set(text, audioBuffer);
            return audioBuffer;
        } catch (e) {
            // Si un servidor falla, pasa automáticamente al siguiente
        }
    }
    return null;
}

// Pre-carga en segundo plano todas las frases del entrenamiento al seleccionarlo
function preloadWorkoutVoices(routine) {
    if (!routine) return;
    const phrases = new Set([
        "¡Vamos!",
        "Descanso. Recupera el aliento.",
        "¡Últimos diez segundos, aguanta!",
        "Entrenamiento en pausa",
        "Reanudamos",
        "¡Entrenamiento completado! Buen trabajo.",
        "Guía de voz activada"
    ]);

    motivationalPhrases.forEach(p => {
        phrases.add(`¡Mitad del tiempo! ${p}`);
    });

    routine.forEach(step => {
        if (!step.isRest) {
            const cleanName = formatSpeechName(step.name);
            phrases.add(`Prepárate para ${cleanName}`);
            phrases.add(`¡Empezamos! ${cleanName}`);
        }
    });

    phrases.forEach(phrase => {
        getVoiceBuffer(phrase);
    });
}

// Reproduce la voz exactamente por el mismo canal WebAudio que los pitidos
async function speakText(text, forceInterrupt = false) {
    if (!isVoiceEnabled) return;

    initAudio();

    if (!forceInterrupt && currentVoiceSource) {
        return;
    }

    if (currentVoiceSource) {
        try {
            currentVoiceSource.onended = null;
            currentVoiceSource.stop();
        } catch (e) {}
        currentVoiceSource = null;
    }

    const buffer = await getVoiceBuffer(text);
    if (!buffer || !isVoiceEnabled) return;

    try {
        if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }

        // Baja ligeramente el volumen de Spotify / Apple Music sin pausar la canción
        setIOSAudioSession('transient');

        const source = audioCtx.createBufferSource();
        const gainNode = audioCtx.createGain();

        source.buffer = buffer;
        gainNode.gain.value = 1.6; // Volumen claro y potente para que destaque sobre la música

        source.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        currentVoiceSource = source;

        source.onended = () => {
            if (currentVoiceSource === source) {
                currentVoiceSource = null;
                // Restaura el volumen de tu música al 100% en cuanto termina la frase
                setIOSAudioSession('ambient');
            }
        };

        source.start(0);
    } catch (e) {
        setIOSAudioSession('ambient');
    }
}

function playBeep(type) {
    if (!isSoundEnabled || !audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();

    if (!currentVoiceSource) {
        setIOSAudioSession('ambient');
    }

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    if (type === 'countdown') {
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(440, audioCtx.currentTime); 
        gainNode.gain.setValueAtTime(0.65, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.18);
        oscillator.start(audioCtx.currentTime);
        oscillator.stop(audioCtx.currentTime + 0.18);
    } else if (type === 'start') {
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); 
        gainNode.gain.setValueAtTime(0.85, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.38);
        oscillator.start(audioCtx.currentTime);
        oscillator.stop(audioCtx.currentTime + 0.38);
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
const btnPrev = document.getElementById('btn-prev');
const btnPause = document.getElementById('btn-pause');
const btnNext = document.getElementById('btn-next');
const btnExit = document.getElementById('btn-exit');
const btnSound = document.getElementById('btn-sound');
const btnVoice = document.getElementById('btn-voice');
const imgGif = document.getElementById('exercise-gif');
const textGif = document.getElementById('gif-text');
const readyOverlay = document.getElementById('ready-overlay');
const btnStartPlay = document.getElementById('btn-start-play');
const btnCancelPlay = document.getElementById('btn-cancel-play');
const countdownDisplay = document.getElementById('countdown-display');

function initApp() {
    document.body.className = 'bg-default';
    setIOSAudioSession('ambient');

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
        speakText(`Prepárate para ${formatSpeechName(currentRoutine[0].name)}`, true);

        prestartInterval = setInterval(() => {
            count--;
            if (count > 0) {
                countdownDisplay.innerText = count;
                playBeep('countdown'); 
            } else {
                clearInterval(prestartInterval);
                readyOverlay.style.display = 'none';
                loadStep(currentStepIndex, true); 
                timerInterval = setInterval(updateTimer, 1000);
            }
        }, 1000);
    });

    // Botón de Pitidos ON/OFF
    btnSound.addEventListener('click', () => {
        isSoundEnabled = !isSoundEnabled;
        btnSound.innerText = isSoundEnabled ? "🔊 Pitidos ON" : "🔇 Pitidos OFF";
        btnSound.classList.toggle('off', !isSoundEnabled);
        if (isSoundEnabled) initAudio();
    });

    // Botón de Voz Guiada ON/OFF
    btnVoice.addEventListener('click', () => {
        initAudio();
        isVoiceEnabled = !isVoiceEnabled;
        btnVoice.innerText = isVoiceEnabled ? "🗣️ Guía ON" : "🤐 Guía OFF";
        btnVoice.classList.toggle('off', !isVoiceEnabled);
        if (isVoiceEnabled) {
            speakText("Guía de voz activada", true);
        } else if (currentVoiceSource) {
            try {
                currentVoiceSource.onended = null;
                currentVoiceSource.stop();
            } catch (e) {}
            currentVoiceSource = null;
            setIOSAudioSession('ambient');
        }
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

function getNextRealExercise(fromIndex) {
    for (let i = fromIndex + 1; i < currentRoutine.length; i++) {
        if (!currentRoutine[i].isRest) {
            return currentRoutine[i];
        }
    }
    return null;
}

function updateNextExercisePreview(fromIndex) {
    const nextExercise = getNextRealExercise(fromIndex);
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

    // Descarga y decodifica en memoria todas las frases de voz de esta rutina
    preloadWorkoutVoices(currentRoutine);

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

function loadStep(index, isFirstAfterCountdown = false) {
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
        speakText("Descanso. Recupera el aliento.", true);
    } else if (isFirstAfterCountdown) {
        speakText("¡Vamos!", false);
    } else {
        speakText(`¡Empezamos! ${formatSpeechName(step.name)}`, true);
    }
    
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

        const step = currentRoutine[currentStepIndex];
        const halfTime = Math.floor(currentStepDuration / 2);

        if (!step.isRest) {
            if (currentStepDuration >= 20 && timeRemainingInStep === halfTime) {
                const randomPhrase = motivationalPhrases[Math.floor(Math.random() * motivationalPhrases.length)];
                speakText(`¡Mitad del tiempo! ${randomPhrase}`, false);
            } else if (currentStepDuration >= 40 && timeRemainingInStep === 10) {
                speakText("¡Últimos diez segundos, aguanta!", false);
            }
        } else {
            if (timeRemainingInStep === 5) {
                const nextEx = getNextRealExercise(currentStepIndex);
                if (nextEx) {
                    speakText(`Prepárate para ${formatSpeechName(nextEx.name)}`, false);
                }
            }
        }

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
        speakText("Entrenamiento en pausa", true);
    } else {
        const step = currentRoutine[currentStepIndex];
        document.body.className = step.isRest ? 'bg-rest' : 'bg-active';
        speakText("Reanudamos", true);
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
    if (currentVoiceSource) {
        try {
            currentVoiceSource.onended = null;
            currentVoiceSource.stop();
        } catch (e) {}
        currentVoiceSource = null;
    }
    setIOSAudioSession('ambient');
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
    speakText("¡Entrenamiento completado! Buen trabajo.", true);
    setTimeout(() => {
        endWorkout();
    }, 3500);
}

document.addEventListener('DOMContentLoaded', initApp);
