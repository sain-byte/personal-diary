// URL Web App Google Apps Script yang baru
const GAS_URL = "https://script.google.com/macros/s/AKfycbyXLHoue3p1WlwXRg03_Ys-Q9kMMsuNxfYPb5VzAbx0Zih7FXX-lNKyuNt79In_h0Cr/exec"; 

let state = {
    token: localStorage.getItem("diary_token") || null,
    currentDiaryId: null,
    aiCorrectedText: "",
    autoSaveTimer: null
};

window.addEventListener("message", (event) => {
    if (event.data && event.data.channel === "PERSONAL_DIARY_GAS") {
        const res = event.data.payload;
        if (window._pendingResolve) {
            window._pendingResolve(res);
            window._pendingResolve = null;
        }
    }
});

function callGas(action, data = {}) {
    return new Promise((resolve, reject) => {
        window._pendingResolve = (res) => {
            if (res && res.ok) resolve(res);
            else reject(new Error(res ? res.error : "Gagal terhubung ke server."));
        };

        const payload = JSON.stringify({ action, token: state.token, ...data });
        const form = document.createElement("form");
        form.method = "POST";
        form.action = GAS_URL;
        form.target = "gas-iframe";

        const input = document.createElement("input");
        input.type = "hidden";
        input.name = "payload";
        input.value = payload;

        form.appendChild(input);
        document.body.appendChild(form);
        form.submit();
        document.body.removeChild(form);
    });
}

window.addEventListener("DOMContentLoaded", () => {
    initTheme();
    if (state.token) {
        validateAndBoot();
    } else {
        showLogin();
    }
});

async function validateAndBoot() {
    try {
        const res = await callGas("validateSession");
        showMainApp();
        loadDashboard();
    } catch (e) {
        handleLogout();
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const password = document.getElementById("password").value;
    const errEl = document.getElementById("login-error");
    errEl.textContent = "";

    try {
        const res = await callGas("login", { password });
        state.token = res.token;
        localStorage.setItem("diary_token", res.token);
        showMainApp();
        loadDashboard();
    } catch (err) {
        errEl.textContent = err.message;
    }
}

function handleLogout() {
    state.token = null;
    localStorage.removeItem("diary_token");
    showLogin();
}

function showLogin() {
    document.getElementById("page-login").classList.add("active");
    document.getElementById("main-layout").classList.add("hidden");
}

function showMainApp() {
    document.getElementById("page-login").classList.remove("active");
    document.getElementById("main-layout").classList.remove("hidden");
    switchPage("dashboard");
}

function switchPage(pageName) {
    document.querySelectorAll(".sub-page").forEach(p => p.classList.remove("active"));
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    
    if (pageName === "dashboard") {
        document.getElementById("page-dashboard").classList.add("active");
        loadDashboard();
    } else if (pageName === "history") {
        document.getElementById("page-history").classList.add("active");
        loadHistoryList();
    } else if (pageName === "settings") {
        document.getElementById("page-settings").classList.add("active");
    } else if (pageName === "editor") {
        document.getElementById("page-editor").classList.add("active");
    }
}

async function loadDashboard() {
    try {
        const res = await callGas("getDashboardStats");
        document.getElementById("stat-total").textContent = res.total_diary || 0;
        document.getElementById("stat-month").textContent = res.month_diary || 0;
        
        const listEl = document.getElementById("recent-list");
        listEl.innerHTML = (res.latest || []).map(item => `
            <div class="diary-item" onclick="openEditor('${item.diary_id}')">
                <div class="diary-item-header">
                    <span>${item.diary_date}</span>
                    <span>${getMoodEmoji(item.mood)}</span>
                </div>
                <div class="diary-item-title">${escapeHtml(item.title || "Tanpa Judul")}</div>
                <div class="diary-item-snippet">${escapeHtml(item.active_content)}</div>
            </div>
        `).join("") || '<p style="font-size:13px; color:var(--text-secondary);">Belum ada diary.</p>';
    } catch (e) {}
}

function openNewEditor() {
    state.currentDiaryId = null;
    document.getElementById("edit-diary-id").value = "";
    document.getElementById("diary-date").value = new Date().toISOString().slice(0, 10);
    document.getElementById("diary-title").value = "";
    document.getElementById("diary-content").value = "";
    document.getElementById("diary-mood").value = "neutral";
    document.getElementById("save-status").textContent = "Draft baru";
    switchPage("editor");
}

async function openEditor(diaryId) {
    try {
        const res = await callGas("getDiaryList");
        const d = res.items.find(x => x.diary_id === diaryId);
        if (!d) throw new Error("Tidak ditemukan");
        state.currentDiaryId = d.diary_id;
        document.getElementById("edit-diary-id").value = d.diary_id;
        document.getElementById("diary-date").value = d.diary_date;
        document.getElementById("diary-title").value = d.title;
        document.getElementById("diary-content").value = d.active_content;
        document.getElementById("diary-mood").value = d.mood || "neutral";
        document.getElementById("save-status").textContent = "Tersimpan";
        switchPage("editor");
    } catch (e) {
        alert(e.message);
    }
}

function handleEditorInput() {
    const content = document.getElementById("diary-content").value;
    const words = content.trim() ? content.trim().split(/\s+/).length : 0;
    const chars = content.length;
    document.getElementById("word-count").textContent = `${words} kata`;
    document.getElementById("char-count").textContent = `${chars} karakter`;
    
    document.getElementById("save-status").textContent = "Belum tersimpan...";
    clearTimeout(state.autoSaveTimer);
    state.autoSaveTimer = setTimeout(() => { saveDiary(true); }, 2000);
}

async function saveDiary(isAuto = false) {
    const title = document.getElementById("diary-title").value;
    const content = document.getElementById("diary-content").value;
    const date = document.getElementById("diary-date").value;
    const mood = document.getElementById("diary-mood").value;

    if (!title && !content) return;

    try {
        const res = await callGas("createDiary", { title, diary_date: date, active_content: content, mood });
        state.currentDiaryId = res.diary_id;
        document.getElementById("save-status").textContent = isAuto ? "Draft tersimpan otomatis" : "Berhasil disimpan!";
    } catch (e) {
        document.getElementById("save-status").textContent = "Gagal menyimpan!";
    }
}

async function requestAiCorrection() {
    const text = document.getElementById("diary-content").value;
    if (!text.trim()) { alert("Tuliskan sesuatu dulu."); return; }
    try {
        const res = await callGas("correctDiary", { text });
        state.aiCorrectedText = res.corrected_text;
        document.getElementById("ai-orig-preview").textContent = text;
        document.getElementById("ai-corr-preview").textContent = res.corrected_text;
        document.getElementById("ai-modal").classList.remove("hidden");
    } catch (e) {
        alert("Koreksi AI gagal: " + e.message);
    }
}

function closeAiModal() { document.getElementById("ai-modal").classList.add("hidden"); }
function applyAiCorrection() {
    document.getElementById("diary-content").value = state.aiCorrectedText;
    handleEditorInput();
    closeAiModal();
    saveDiary();
}

async function loadHistoryList() {
    try {
        const res = await callGas("getDiaryList");
        const listEl = document.getElementById("history-list");
        listEl.innerHTML = res.items.map(item => `
            <div class="diary-item" onclick="openEditor('${item.diary_id}')">
                <div class="diary-item-header">
                    <span>${item.diary_date}</span>
                    <span>${getMoodEmoji(item.mood)}</span>
                </div>
                <div class="diary-item-title">${escapeHtml(item.title || "Tanpa Judul")}</div>
                <div class="diary-item-snippet">${escapeHtml(item.active_content)}</div>
            </div>
        `).join("") || '<p style="font-size:13px; color:var(--text-secondary);">Belum ada riwayat.</p>';
    } catch (e) {}
}

function initTheme() {
    const theme = localStorage.getItem("diary_theme") || "light";
    document.documentElement.setAttribute("data-theme", theme);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("diary_theme", next);
}

function getMoodEmoji(mood) {
    const map = { happy: "😊", excited: "🤩", calm: "😌", grateful: "🙏", sad: "😢", tired: "🥱", anxious: "😰", angry: "😡", neutral: "😐" };
    return map[mood] || "😐";
}

function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
