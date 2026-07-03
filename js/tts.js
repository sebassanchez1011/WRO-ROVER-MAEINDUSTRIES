const VOCES_TTS = {
  synthesis: window.speechSynthesis,
  voice: null,
  voiceName: '',
  isSpeaking: false,
  isListening: false,
  recognition: null,
  onResult: null,
  onListeningChange: null,
  manualStop: false,
  restartTimer: null,

  init() {
    if (!window.speechSynthesis) { console.warn('TTS no soportado'); return; }
    this.loadVoices();
    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = () => { this.loadVoices(); };
    }
    this._initRecognition();
  },

  _initRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    this.recognition = new SR();
    this.recognition.lang = 'es-CR';
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 3;

    this.recognition.onresult = (e) => {
      let finalTranscript = '';
      let interimTranscript = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalTranscript += t;
        else interimTranscript += t;
      }
      if (this.onResult) this.onResult(finalTranscript || interimTranscript, !!finalTranscript);
    };

    this.recognition.onend = () => {
      if (this.isListening && !this.manualStop) {
        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => {
          if (this.isListening && !this.manualStop) {
            try {
              this.recognition = new SR();
              this._initRecognition();
              this.recognition.start();
            } catch(e) {
              this.isListening = false;
              if (this.onListeningChange) this.onListeningChange(false);
            }
          }
        }, 300);
      } else {
        this.isListening = false;
        this.manualStop = false;
        if (this.onListeningChange) this.onListeningChange(false);
      }
    };

    this.recognition.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') {
        if (this.isListening && !this.manualStop) {
          return;
        }
        return;
      }
      if (e.error === 'not-allowed') {
        this.isListening = false;
        if (this.onListeningChange) this.onListeningChange(false);
        alert('Permiso del micrófono denegado. Ve a la configuración de Brave y permite el micrófono para este sitio.');
        return;
      }
      console.warn('Speech error:', e.error);
      this.isListening = false;
      if (this.onListeningChange) this.onListeningChange(false);
    };
  },

  loadVoices() {
    const voices = this.synthesis.getVoices();
    if (!voices || voices.length === 0) return;
    console.log('Voces disponibles:', voices.map(v => v.name + ' (' + v.lang + ')').join(', '));
    const preferred = [
      'Google español',
      'Google español de Estados Unidos',
      'Microsoft Sabina',
      'Microsoft Helena',
      'Microsoft Laura',
      'Microsoft Pablo',
      'es-ES',
      'es-MX',
      'es'
    ];
    for (const name of preferred) {
      this.voice = voices.find(v => v.name.includes(name));
      if (this.voice) { this.voiceName = this.voice.name; break; }
    }
    if (!this.voice) {
      this.voice = voices.find(v => v.lang && v.lang.startsWith('es')) || voices[0] || null;
    }
    if (this.voice) {
      this.voiceName = this.voice.name;
      console.log('Voz seleccionada:', this.voiceName);
    }
  },

  async speak(text, onEnd) {
    const cleanText = text.replace(/<[^>]*>/g, '').trim();
    if (!cleanText) { if (onEnd) onEnd(); return; }

    if (navigator.onLine) {
      try {
        await this._speakCloud(cleanText, onEnd);
        return;
      } catch(e) {
        console.log('Cloud TTS falló, usando local:', e.message);
      }
    }
    this._speakLocal(cleanText, onEnd);
  },

  _speakCloud(text, onEnd) {
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      fetch('https://freetts.org/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: 'es-MX-JorgeNeural', rate: '+0%', pitch: '+0Hz' }),
        signal: controller.signal
      })
      .then(r => r.json())
      .then(data => {
        clearTimeout(timeout);
        if (!data.file_id) { reject(new Error('No file_id')); return; }
        fetch('https://freetts.org/api/audio/' + data.file_id)
          .then(r => r.blob())
          .then(blob => {
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            this.isSpeaking = true;
            audio.onended = () => {
              this.isSpeaking = false;
              URL.revokeObjectURL(url);
              if (onEnd) onEnd();
              resolve();
            };
            audio.onerror = () => {
              this.isSpeaking = false;
              URL.revokeObjectURL(url);
              reject(new Error('Audio playback error'));
            };
            audio.play().catch(reject);
          })
          .catch(reject);
      })
      .catch(e => {
        clearTimeout(timeout);
        reject(e);
      });
    });
  },

  _speakLocal(text, onEnd) {
    if (!this.synthesis) { if (onEnd) onEnd(); return; }
    this.synthesis.cancel();
    this.loadVoices();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-CR';
    utterance.rate = 0.85;
    utterance.pitch = 1.0;
    utterance.volume = 1;
    if (this.voice) utterance.voice = this.voice;

    this.isSpeaking = true;
    utterance.onend = () => { this.isSpeaking = false; if (onEnd) onEnd(); };
    utterance.onerror = () => { this.isSpeaking = false; if (onEnd) onEnd(); };
    this.synthesis.speak(utterance);
  },

  stop() {
    if (this.synthesis) this.synthesis.cancel();
    this.isSpeaking = false;
  },

  startListening() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert('El reconocimiento de voz no está disponible en este navegador. Prueba con Chrome, Edge o Brave.');
      return;
    }
    if (this.isListening) { this.stopListening(); return; }
    this.manualStop = false;
    this.isListening = true;
    if (this.onListeningChange) this.onListeningChange(true);
    try {
      this.recognition = new SR();
      this._initRecognition();
      this.recognition.start();
    } catch(e) {
      this.isListening = false;
      if (this.onListeningChange) this.onListeningChange(false);
    }
  },

  stopListening() {
    if (this.recognition && this.isListening) {
      this.manualStop = true;
      if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
      try { this.recognition.stop(); } catch(e) {}
      this.isListening = false;
      if (this.onListeningChange) this.onListeningChange(false);
    }
  },

  toggleListening() {
    if (this.isListening) this.stopListening();
    else this.startListening();
  },

  isSupported() {
    return !!(window.speechSynthesis && (window.SpeechRecognition || window.webkitSpeechRecognition));
  }
};
