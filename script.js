/* ═══════════ STATE ═══════════ */
const PRAYERS = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];
const AR = {
  fajr: "الفجر",
  sunrise: "الشروق",
  dhuhr: "الظهر",
  asr: "العصر",
  maghrib: "المغرب",
  isha: "العشاء",
};
const AZAN_URL = "https://www.islamcan.com/audio/adhan/azan1.mp3";

let prayerMap = {},
  currentNextId = null,
  countdownInt = null,
  checkInt = null;
let notifOn = false,
  soundOn = false,
  darkOn = false;
let firedToday = new Set(),
  azanAudio = null,
  azanPlaying = false,
  toastTimer = null;
let tasbeehCount = 0,
  tasbeehTotal = 0,
  currentPhrase = "سبحان الله";

/* ═══════════ INIT ═══════════ */
setDates();
loadPrayers();
if (window.matchMedia("(prefers-color-scheme:dark)").matches) toggleDark();

/* ═══════════ DATES ═══════════ */
function setDates() {
  const now = new Date();
  document.getElementById("gregorian-date").textContent =
    now.toLocaleDateString("ar-EG", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  try {
    document.getElementById("hijri-date").textContent = now.toLocaleDateString(
      "ar-SA-u-ca-islamic-umalqura",
      { year: "numeric", month: "long", day: "numeric" },
    );
  } catch (e) {}
}

/* ═══════════ LOAD PRAYERS ═══════════ */
async function loadPrayers(lat, lon) {
  PRAYERS.forEach((id) => {
    document.getElementById(id).innerHTML = '<span class="skeleton"></span>';
    document.getElementById("card-" + id).classList.remove("active");
    document.getElementById("cc-" + id).textContent = "";
  });
  document.getElementById("next-prayer-name").textContent = "جاري التحميل…";
  document.getElementById("countdown-display").textContent = "--:--:--";

  try {
    let url;
    if (lat != null && lon != null) {
      url = `https://api.aladhan.com/v1/timings?latitude=${lat}&longitude=${lon}&method=5`;
    } else {
      const sel = document.getElementById("city-select");
      const opt = sel.options[sel.selectedIndex];
      url = `https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(opt.value)}&country=${opt.dataset.country}&method=5`;
    }
    const res = await fetch(url);
    const json = await res.json();
    if (json.code !== 200) throw new Error("API error");

    const t = json.data.timings;
    const clean = (s) => s.split(" ")[0].trim();
    prayerMap = {
      fajr: clean(t.Fajr),
      sunrise: clean(t.Sunrise),
      dhuhr: clean(t.Dhuhr),
      asr: clean(t.Asr),
      maghrib: clean(t.Maghrib),
      isha: clean(t.Isha),
    };
    Object.entries(prayerMap).forEach(([id, raw]) => {
      document.getElementById(id).textContent = fmt12(raw);
    });
    firedToday = new Set();
    startCountdown();
    startChecker();
  } catch (e) {
    PRAYERS.forEach((id) => (document.getElementById(id).textContent = "—"));
    showToast("تعذّر جلب المواقيت، تحقق من الإنترنت");
  }
}

/* ═══════════ COUNTDOWN ═══════════ */
function startCountdown() {
  if (countdownInt) clearInterval(countdownInt);
  tick();
  countdownInt = setInterval(tick, 1000);
}

function tick() {
  if (!Object.keys(prayerMap).length) return;
  const now = new Date();
  const nowSecs =
    now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  let nxtId = null,
    nxtSecs = Infinity;

  for (const id of PRAYERS) {
    const raw = (prayerMap[id] || "").split(" ")[0];
    const parts = raw.split(":");
    if (parts.length < 2) continue;
    const h = parseInt(parts[0], 10),
      m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) continue;
    const ps = h * 3600 + m * 60;
    if (ps > nowSecs && ps - nowSecs < nxtSecs) {
      nxtSecs = ps - nowSecs;
      nxtId = id;
    }
  }
  if (!nxtId && prayerMap.fajr) {
    const p = prayerMap.fajr.split(" ")[0].split(":");
    const h = parseInt(p[0], 10),
      m = parseInt(p[1], 10);
    nxtSecs = 86400 - nowSecs + h * 3600 + m * 60;
    nxtId = "fajr";
  }
  if (!nxtId) return;

  if (nxtId !== currentNextId) {
    PRAYERS.forEach((id) => {
      document.getElementById("card-" + id).classList.remove("active");
      document.getElementById("cc-" + id).textContent = "";
    });
    currentNextId = nxtId;
    document.getElementById("card-" + currentNextId).classList.add("active");
    document.getElementById("next-prayer-name").textContent = AR[currentNextId];
  }

  const h = Math.floor(nxtSecs / 3600);
  const m = Math.floor((nxtSecs % 3600) / 60);
  const s = nxtSecs % 60;
  const str = `${pad(h)}:${pad(m)}:${pad(s)}`;
  document.getElementById("countdown-display").textContent = str;
  document.getElementById("cc-" + currentNextId).textContent = `⏱ باقي ${str}`;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

/* ═══════════ CHECKER ═══════════ */
function startChecker() {
  if (checkInt) clearInterval(checkInt);
  checkInt = setInterval(() => {
    if (!Object.keys(prayerMap).length) return;
    const now = new Date();
    const h = now.getHours(),
      m = now.getMinutes();
    for (const id of PRAYERS) {
      if (firedToday.has(id)) continue;
      const raw = (prayerMap[id] || "").split(" ")[0].split(":");
      const ph = parseInt(raw[0], 10),
        pm = parseInt(raw[1], 10);
      if (ph === h && pm === m) {
        firedToday.add(id);
        onPrayerTime(id);
      }
    }
  }, 10000);
}

function onPrayerTime(id) {
  const name = AR[id];
  if (notifOn && Notification.permission === "granted") {
    new Notification(`🕌 حان وقت ${name}`, {
      body: `لا تنسَ الدعاء ليوسف بعد الصلاة 🤍`,
      icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🕌</text></svg>",
    });
  }
  if (soundOn) playAzan(name);
  showToast(`حان وقت صلاة ${name} — ادعُ ليوسف 🤍`);
}

/* ═══════════ AZAN ═══════════ */
function playAzan(name) {
  if (!azanAudio) {
    azanAudio = new Audio(AZAN_URL);
    azanAudio.addEventListener("timeupdate", () => {
      if (!azanAudio.duration) return;
      document.getElementById("azan-progress-fill").style.width =
        (azanAudio.currentTime / azanAudio.duration) * 100 + "%";
    });
    azanAudio.addEventListener("ended", () => {
      azanPlaying = false;
      document.getElementById("azan-play-pause").textContent = "▶";
      setTimeout(closeAzanBar, 1500);
    });
  }
  azanAudio.currentTime = 0;
  azanAudio
    .play()
    .then(() => {
      azanPlaying = true;
      document.getElementById("azan-bar-title").textContent =
        `حان وقت صلاة ${name}`;
      document.getElementById("azan-play-pause").textContent = "⏸";
      document.getElementById("azan-bar").classList.add("visible");
    })
    .catch(() => showToast("يتطلب المتصفح تفاعلاً لتشغيل الأذان"));
}

function toggleAzanPlayback() {
  if (!azanAudio) return;
  if (azanPlaying) {
    azanAudio.pause();
    azanPlaying = false;
    document.getElementById("azan-play-pause").textContent = "▶";
  } else {
    azanAudio.play();
    azanPlaying = true;
    document.getElementById("azan-play-pause").textContent = "⏸";
  }
}

function closeAzanBar() {
  if (azanAudio) {
    azanAudio.pause();
    azanPlaying = false;
  }
  document.getElementById("azan-bar").classList.remove("visible");
}

function toggleSound() {
  soundOn = !soundOn;
  const btn = document.getElementById("sound-btn"),
    top = document.getElementById("sound-top-btn");
  if (soundOn) {
    btn.classList.add("on");
    btn.querySelector(".feat-icon").textContent = "🔊";
    top.textContent = "🔊";
    showToast("صوت الأذان مفعّل ✅");
    playAzan("الاختبار");
  } else {
    btn.classList.remove("on");
    btn.querySelector(".feat-icon").textContent = "🔇";
    top.textContent = "🔇";
    closeAzanBar();
    showToast("صوت الأذان متوقف");
  }
}

/* ═══════════ NOTIFICATIONS ═══════════ */
async function toggleNotifications() {
  if (notifOn) {
    notifOn = false;
    setNotifUI(false);
    showToast("تم إيقاف الإشعارات");
    return;
  }
  if (!("Notification" in window)) {
    showToast("متصفحك لا يدعم الإشعارات");
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm === "granted") {
    notifOn = true;
    setNotifUI(true);
    showToast("تم تفعيل الإشعارات ✅");
    new Notification("مواقيت الصلاة 🕌", {
      body: "سيتم تذكيرك بالدعاء ليوسف عند كل صلاة 🤍",
    });
  } else {
    showToast("تعذّر الحصول على الإذن");
  }
}
function setNotifUI(on) {
  document.getElementById("notif-btn").classList.toggle("on", on);
  document.getElementById("notif-top-btn").textContent = on ? "🔔" : "🔕";
}

/* ═══════════ GPS ═══════════ */
function detectLocation() {
  if (!navigator.geolocation) {
    showToast("متصفحك لا يدعم تحديد الموقع");
    return;
  }
  const btn = document.getElementById("gps-btn");
  btn.classList.add("loading");
  document.getElementById("gps-label").textContent = "جاري التحديد…";
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      try {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=ar`,
        );
        const j = await r.json();
        document.getElementById("gps-label").textContent =
          j.address.city || j.address.town || j.address.village || "موقعك";
      } catch (e) {
        document.getElementById("gps-label").textContent = "موقع مخصص";
      }
      btn.classList.remove("loading");
      loadPrayers(lat, lon);
    },
    () => {
      btn.classList.remove("loading");
      document.getElementById("gps-label").textContent = "موقعي تلقائياً";
      showToast("تعذّر تحديد الموقع");
    },
  );
}

/* ═══════════ DARK MODE ═══════════ */
function toggleDark() {
  darkOn = !darkOn;
  document.documentElement.setAttribute(
    "data-theme",
    darkOn ? "dark" : "light",
  );
  document.getElementById("dark-toggle").textContent = darkOn ? "☀️" : "🌙";
}

/* ═══════════ TASBEEH ═══════════ */
function setPhrase(btn, phrase) {
  document
    .querySelectorAll(".phrase-btn")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  currentPhrase = phrase;
  document.getElementById("tasbeeh-phrase").textContent = phrase;
  tasbeehCount = 0;
  document.getElementById("tasbeeh-count").textContent = "0";
}

function incrementTasbeeh() {
  tasbeehCount++;
  tasbeehTotal++;
  document.getElementById("tasbeeh-count").textContent = tasbeehCount;
  document.getElementById("tasbeeh-total").textContent =
    `المجموع الكلي: ${tasbeehTotal}`;
  if (tasbeehCount % 33 === 0) {
    showToast(`أتممت ${tasbeehCount} — بارك الله فيك، ثوابها ليوسف 🤍`);
  }
}

function resetTasbeeh() {
  tasbeehCount = 0;
  document.getElementById("tasbeeh-count").textContent = "0";
}

/* ═══════════ DUA POPUP ═══════════ */
function openDua() {
  document.getElementById("dua-popup").classList.add("show");
  document.body.style.overflow = "hidden";
}
function closeDua(e) {
  if (e.target === document.getElementById("dua-popup")) closeDuaBtn();
}
function closeDuaBtn() {
  document.getElementById("dua-popup").classList.remove("show");
  document.body.style.overflow = "";
}

/* ═══════════ HELPERS ═══════════ */
function fmt12(raw) {
  const [hs, ms] = raw.split(":");
  let h = parseInt(hs, 10);
  const m = ms.padStart(2, "0");
  const suf = h < 12 ? "ص" : "م";
  h = h % 12 || 12;
  return `${h}:${m} ${suf}`;
}
function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
}
