/*
 * User-facing text in English (default), Portuguese and Spanish.
 * t('key', { name: 'x' }) fills {name}; elements with data-i18n="key" are filled by apply().
 */
var I18n = (function () {
  var STORAGE_KEY = 'frigatetv.lang';
  var DEFAULT = 'en';

  var LANGS = [
    { code: 'en', name: 'English', locale: 'en-US' },
    { code: 'pt', name: 'Português', locale: 'pt-BR' },
    { code: 'es', name: 'Español', locale: 'es-ES' }
  ];

  var strings = {
    en: {
      'start.connecting': 'Connecting to {url}…',
      'home.updating': 'Updating…',
      'home.alertsUnavailable': 'Alerts unavailable',
      'home.settings': 'Settings',
      'row.live': 'Live',
      'row.alerts': 'Recent alerts',
      'row.detections': 'Recent detections',
      'row.recordings': 'Recordings',
      'row.empty': 'Nothing in the last few days.',
      'tag.live': 'LIVE',
      'tag.alert': 'ALERT',
      'tag.detection': 'DETECTION',
      'tag.recording': 'RECORDING',
      'tile.birdseye': 'All cameras with activity',
      'tile.mainSub': 'Main and sub stream',
      'tile.timeline': 'Hourly timeline',
      'live.none': 'No camera has live video in go2rtc.',
      'live.connecting': 'Connecting…',
      'live.birdseyeIdle': 'Birdseye has no activity right now\n◀ ▶ to see the cameras',
      'live.waiting': 'Waiting for video from {name}…',
      'live.birdseyeRetry': 'Birdseye has no activity — reconnecting…',
      'live.noSignal': 'No signal from {name} — reconnecting…',
      'live.main': 'Main stream',
      'live.sub': 'Sub stream (light)',
      'live.oneStream': 'This camera has a single stream.',
      'common.position': '{n} of {total}',
      'vod.loading': 'Loading…',
      'vod.paused': '❚❚  Paused',
      'vod.first': 'This is the first one.',
      'vod.last': 'This is the last one.',
      'vod.hourRange': '{day}, {from} to {to}',
      'rec.title': 'Recordings · {name}',
      'rec.hint': 'OK plays the hour · BACK returns',
      'rec.events': '{n} events',
      'rec.event': '1 event',
      'rec.noEvents': 'no events',
      'rec.empty': 'No recordings found.',
      'rec.loadError': 'Could not load recordings: {msg}',
      'day.today': 'Today',
      'day.yesterday': 'Yesterday',
      'when.now': 'now',
      'when.minAgo': '{n} min ago',
      'when.today': 'today {time}',
      'when.other': '{day} {time}',
      'review.motion': 'motion',
      'settings.title': 'Settings',
      'settings.url': 'Frigate address (internal port, no login)',
      'settings.go2rtc': 'Live video comes from go2rtc, on port 1984 of the same address.',
      'settings.language': 'Language',
      'settings.save': 'Save and connect',
      'settings.back': 'Back',
      'settings.firstRun': 'Enter the address of your Frigate server, for example http://192.168.1.10:5000',
      'error.http': 'HTTP {status} at {path}',
      'error.badResponse': 'Invalid response from {path}',
      'error.offline': 'No connection to {url}',
      'error.timeout': 'Timed out waiting for {url}',
      'error.open': 'Could not open the video: {msg}',
      'error.player': 'Player error: {msg}',
      'error.video': 'Video error',
      'error.noHls': 'This browser cannot play HLS ({msg})',
      'audio.none': 'No audio',
      'live.hlsFallback': '{name}: no low-delay video from go2rtc, playing over HLS.',
      'live.subFallback': '{name}: the main stream did not play on this TV, switched to the sub stream (▲ ▼ to try again).',
      'live.otherAudio': 'This TV cannot play that audio format: trying another one.',
      'settings.live': 'Live video',
      'settings.hls': 'HLS (compatible)',
      'settings.mse': 'MSE (low delay, default)',
      'notify.hintOk': 'OK: watch live',
      'notify.hintPlay': '⏯: watch live',
      'home.markAll': 'Mark all as seen',
      'home.offline': 'No connection to Frigate — retrying…',
      'start.offline': 'Could not reach Frigate at {url}.',
      'start.retry': 'Trying again in {n} s · OK: try now · BLUE: Settings',
      'vod.hintReview': '◀ ▶ rewind/forward   ·   ▲ ▼ previous/next alert   ·   YELLOW full recording   ·   OK pause   ·   BACK exit',
      'vod.hintRec': '◀ ▶ rewind/forward   ·   ▲ ▼ previous/next event   ·   CH ▲▼ hour   ·   OK pause   ·   BACK exit',
      'vod.noEvents': 'No more events in this hour.',
      'live.hint': '◀ ▶ switch camera   ·   ▲ ▼ quality   ·   OK cameras   ·   0–9 jump to camera   ·   BACK menu',
      'strip.hint': '◀ ▶ choose   ·   OK watch   ·   BACK close',
      'keys.red': 'Alerts',
      'keys.green': 'Birdseye',
      'keys.yellow': 'Last camera',
      'keys.blue': 'Settings'
    },
    pt: {
      'start.connecting': 'Conectando a {url}…',
      'home.updating': 'Atualizando…',
      'home.alertsUnavailable': 'Alertas indisponíveis',
      'home.settings': 'Configurações',
      'row.live': 'Ao vivo',
      'row.alerts': 'Alertas recentes',
      'row.detections': 'Detecções recentes',
      'row.recordings': 'Gravações',
      'row.empty': 'Nada nos últimos dias.',
      'tag.live': 'AO VIVO',
      'tag.alert': 'ALERTA',
      'tag.detection': 'DETECÇÃO',
      'tag.recording': 'GRAVAÇÃO',
      'tile.birdseye': 'Todas as câmeras com atividade',
      'tile.mainSub': 'Principal e sub-stream',
      'tile.timeline': 'Linha do tempo por hora',
      'live.none': 'Nenhuma câmera com vídeo ao vivo no go2rtc.',
      'live.connecting': 'Conectando…',
      'live.birdseyeIdle': 'Birdseye sem atividade no momento\n◀ ▶ para ver as câmeras',
      'live.waiting': 'Aguardando vídeo de {name}…',
      'live.birdseyeRetry': 'Birdseye sem atividade — reconectando…',
      'live.noSignal': 'Sem sinal de {name} — reconectando…',
      'live.main': 'Stream principal',
      'live.sub': 'Sub-stream (leve)',
      'live.oneStream': 'Esta câmera tem um só stream.',
      'common.position': '{n} de {total}',
      'vod.loading': 'Carregando…',
      'vod.paused': '❚❚  Pausado',
      'vod.first': 'Este é o primeiro.',
      'vod.last': 'Este é o último.',
      'vod.hourRange': '{day}, {from} às {to}',
      'rec.title': 'Gravações · {name}',
      'rec.hint': 'OK assiste a hora · VOLTAR retorna',
      'rec.events': '{n} eventos',
      'rec.event': '1 evento',
      'rec.noEvents': 'sem eventos',
      'rec.empty': 'Nenhuma gravação encontrada.',
      'rec.loadError': 'Não foi possível carregar as gravações: {msg}',
      'day.today': 'Hoje',
      'day.yesterday': 'Ontem',
      'when.now': 'agora',
      'when.minAgo': 'há {n} min',
      'when.today': 'hoje {time}',
      'when.other': '{day} {time}',
      'review.motion': 'movimento',
      'settings.title': 'Configurações',
      'settings.url': 'Endereço do Frigate (porta interna, sem login)',
      'settings.go2rtc': 'O vídeo ao vivo vem do go2rtc, na porta 1984 do mesmo endereço.',
      'settings.language': 'Idioma',
      'settings.save': 'Salvar e conectar',
      'settings.back': 'Voltar',
      'settings.firstRun': 'Informe o endereço do seu servidor Frigate, por exemplo http://192.168.1.10:5000',
      'error.http': 'HTTP {status} em {path}',
      'error.badResponse': 'Resposta inválida de {path}',
      'error.offline': 'Sem conexão com {url}',
      'error.timeout': 'Tempo esgotado em {url}',
      'error.open': 'Não foi possível abrir o vídeo: {msg}',
      'error.player': 'Erro do player: {msg}',
      'error.video': 'Erro no vídeo',
      'error.noHls': 'Este navegador não toca HLS ({msg})',
      'audio.none': 'Sem áudio',
      'live.hlsFallback': '{name}: o go2rtc não mandou vídeo de baixo atraso, tocando por HLS.',
      'live.subFallback': '{name}: o stream principal não tocou nesta TV, mudei para o sub-stream (▲ ▼ tenta de novo).',
      'live.otherAudio': 'A TV não toca esse formato de áudio: tentando outro.',
      'settings.live': 'Vídeo ao vivo',
      'settings.hls': 'HLS (compatível)',
      'settings.mse': 'MSE (baixo atraso, padrão)',
      'notify.hintOk': 'OK: ver ao vivo',
      'notify.hintPlay': '⏯: ver ao vivo',
      'home.markAll': 'Marcar todos como vistos',
      'home.offline': 'Sem conexão com o Frigate — tentando de novo…',
      'start.offline': 'Não foi possível falar com o Frigate em {url}.',
      'start.retry': 'Tentando de novo em {n} s · OK: tentar agora · AZUL: Configurações',
      'vod.hintReview': '◀ ▶ voltar/avançar   ·   ▲ ▼ alerta anterior/próximo   ·   AMARELO gravação completa   ·   OK pausa   ·   VOLTAR sair',
      'vod.hintRec': '◀ ▶ voltar/avançar   ·   ▲ ▼ evento anterior/próximo   ·   CH ▲▼ hora   ·   OK pausa   ·   VOLTAR sair',
      'vod.noEvents': 'Não há mais eventos nesta hora.',
      'live.hint': '◀ ▶ trocar câmera   ·   ▲ ▼ qualidade   ·   OK câmeras   ·   0–9 câmera direta   ·   VOLTAR menu',
      'strip.hint': '◀ ▶ escolher   ·   OK assistir   ·   VOLTAR fechar',
      'keys.red': 'Alertas',
      'keys.green': 'Birdseye',
      'keys.yellow': 'Última câmera',
      'keys.blue': 'Configurações'
    },
    es: {
      'start.connecting': 'Conectando con {url}…',
      'home.updating': 'Actualizando…',
      'home.alertsUnavailable': 'Alertas no disponibles',
      'home.settings': 'Ajustes',
      'row.live': 'En vivo',
      'row.alerts': 'Alertas recientes',
      'row.detections': 'Detecciones recientes',
      'row.recordings': 'Grabaciones',
      'row.empty': 'Nada en los últimos días.',
      'tag.live': 'EN VIVO',
      'tag.alert': 'ALERTA',
      'tag.detection': 'DETECCIÓN',
      'tag.recording': 'GRABACIÓN',
      'tile.birdseye': 'Todas las cámaras con actividad',
      'tile.mainSub': 'Principal y sub-stream',
      'tile.timeline': 'Línea de tiempo por hora',
      'live.none': 'Ninguna cámara tiene video en vivo en go2rtc.',
      'live.connecting': 'Conectando…',
      'live.birdseyeIdle': 'Birdseye sin actividad en este momento\n◀ ▶ para ver las cámaras',
      'live.waiting': 'Esperando video de {name}…',
      'live.birdseyeRetry': 'Birdseye sin actividad — reconectando…',
      'live.noSignal': 'Sin señal de {name} — reconectando…',
      'live.main': 'Stream principal',
      'live.sub': 'Sub-stream (ligero)',
      'live.oneStream': 'Esta cámara tiene un solo stream.',
      'common.position': '{n} de {total}',
      'vod.loading': 'Cargando…',
      'vod.paused': '❚❚  En pausa',
      'vod.first': 'Este es el primero.',
      'vod.last': 'Este es el último.',
      'vod.hourRange': '{day}, de {from} a {to}',
      'rec.title': 'Grabaciones · {name}',
      'rec.hint': 'OK reproduce la hora · VOLVER regresa',
      'rec.events': '{n} eventos',
      'rec.event': '1 evento',
      'rec.noEvents': 'sin eventos',
      'rec.empty': 'No se encontraron grabaciones.',
      'rec.loadError': 'No se pudieron cargar las grabaciones: {msg}',
      'day.today': 'Hoy',
      'day.yesterday': 'Ayer',
      'when.now': 'ahora',
      'when.minAgo': 'hace {n} min',
      'when.today': 'hoy {time}',
      'when.other': '{day} {time}',
      'review.motion': 'movimiento',
      'settings.title': 'Ajustes',
      'settings.url': 'Dirección de Frigate (puerto interno, sin inicio de sesión)',
      'settings.go2rtc': 'El video en vivo viene de go2rtc, en el puerto 1984 de la misma dirección.',
      'settings.language': 'Idioma',
      'settings.save': 'Guardar y conectar',
      'settings.back': 'Volver',
      'settings.firstRun': 'Introduce la dirección de tu servidor Frigate, por ejemplo http://192.168.1.10:5000',
      'error.http': 'HTTP {status} en {path}',
      'error.badResponse': 'Respuesta no válida de {path}',
      'error.offline': 'Sin conexión con {url}',
      'error.timeout': 'Tiempo de espera agotado con {url}',
      'error.open': 'No se pudo abrir el video: {msg}',
      'error.player': 'Error del reproductor: {msg}',
      'error.video': 'Error de video',
      'error.noHls': 'Este navegador no reproduce HLS ({msg})',
      'audio.none': 'Sin audio',
      'live.hlsFallback': '{name}: go2rtc no envió video de bajo retraso, se reproduce por HLS.',
      'live.subFallback': '{name}: el stream principal no se reprodujo en este TV, cambié al sub-stream (▲ ▼ para reintentar).',
      'live.otherAudio': 'El TV no reproduce ese formato de audio: probando otro.',
      'settings.live': 'Video en vivo',
      'settings.hls': 'HLS (compatible)',
      'settings.mse': 'MSE (bajo retraso, predeterminado)',
      'notify.hintOk': 'OK: ver en vivo',
      'notify.hintPlay': '⏯: ver en vivo',
      'home.markAll': 'Marcar todo como visto',
      'home.offline': 'Sin conexión con Frigate — reintentando…',
      'start.offline': 'No se pudo conectar con Frigate en {url}.',
      'start.retry': 'Reintentando en {n} s · OK: intentar ahora · AZUL: Ajustes',
      'vod.hintReview': '◀ ▶ retroceder/avanzar   ·   ▲ ▼ alerta anterior/siguiente   ·   AMARILLO grabación completa   ·   OK pausa   ·   VOLVER salir',
      'vod.hintRec': '◀ ▶ retroceder/avanzar   ·   ▲ ▼ evento anterior/siguiente   ·   CH ▲▼ hora   ·   OK pausa   ·   VOLVER salir',
      'vod.noEvents': 'No hay más eventos en esta hora.',
      'live.hint': '◀ ▶ cambiar cámara   ·   ▲ ▼ calidad   ·   OK cámaras   ·   0–9 ir a cámara   ·   VOLVER menú',
      'strip.hint': '◀ ▶ elegir   ·   OK ver   ·   VOLVER cerrar',
      'keys.red': 'Alertas',
      'keys.green': 'Birdseye',
      'keys.yellow': 'Última cámara',
      'keys.blue': 'Ajustes'
    }
  };

  // Frigate's object labels.
  var labels = {
    pt: {
      person: 'pessoa', car: 'carro', dog: 'cachorro', cat: 'gato', bicycle: 'bicicleta',
      motorcycle: 'moto', bird: 'pássaro', truck: 'caminhão', bus: 'ônibus', horse: 'cavalo',
      package: 'pacote', face: 'rosto', license_plate: 'placa', boat: 'barco'
    },
    es: {
      person: 'persona', car: 'coche', dog: 'perro', cat: 'gato', bicycle: 'bicicleta',
      motorcycle: 'moto', bird: 'pájaro', truck: 'camión', bus: 'autobús', horse: 'caballo',
      package: 'paquete', face: 'rostro', license_plate: 'matrícula', boat: 'barco'
    }
  };

  var dates = {
    en: { days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      format: function (wd, d, m) { return wd + ', ' + m + ' ' + d; } },
    pt: { days: ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'],
      months: ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'],
      format: function (wd, d, m) { return wd + ' ' + d + ' de ' + m; } },
    es: { days: ['dom.', 'lun.', 'mar.', 'mié.', 'jue.', 'vie.', 'sáb.'],
      months: ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sept.', 'oct.', 'nov.', 'dic.'],
      format: function (wd, d, m) { return wd + ' ' + d + ' de ' + m; } }
  };

  var lang = DEFAULT;

  function valid(code) { return Object.prototype.hasOwnProperty.call(strings, code); }

  function load() {
    var saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) { /* storage unavailable */ }
    lang = valid(saved) ? saved : DEFAULT;
    return lang;
  }

  function set(code) {
    if (!valid(code)) return;
    lang = code;
    try { localStorage.setItem(STORAGE_KEY, code); } catch (e) { /* storage unavailable */ }
    if (typeof document !== 'undefined') apply(document);
  }

  function t(key, params) {
    var s = strings[lang][key];
    if (s == null) s = strings[DEFAULT][key];
    if (s == null) return key;
    return params ? s.replace(/\{(\w+)\}/g, function (m, k) { return params[k] != null ? String(params[k]) : m; }) : s;
  }

  function label(name) {
    var l = labels[lang] && labels[lang][name];
    return l || String(name).replace(/_/g, ' ');
  }

  /** "Mon, Nov 3" / "seg. 3 de nov." / "lun. 3 de nov." */
  function date(d) {
    var f = dates[lang];
    return f.format(f.days[d.getDay()], d.getDate(), f.months[d.getMonth()]);
  }

  function apply(root) {
    var els = root.querySelectorAll('[data-i18n]');
    for (var i = 0; i < els.length; i++) els[i].textContent = t(els[i].getAttribute('data-i18n'));
    if (root.documentElement) root.documentElement.lang = current().locale;
  }

  function current() { return LANGS.filter(function (l) { return l.code === lang; })[0]; }

  return {
    LANGS: LANGS, load: load, set: set, t: t, label: label, date: date, apply: apply,
    lang: function () { return lang; }, current: current,
    _strings: strings
  };
})();

if (typeof module !== 'undefined') module.exports = I18n;
