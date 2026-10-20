// ==========================================
// スパ2X キャラ戦 チーム管理＆OBSツール - script.js
// ==========================================

const firebaseConfig = {
  apiKey: "AIzaSyDMgiXpRGBLJofwxWEh0pG5b3FQ7yZNLK8",
  authDomain: "sf2x-app.firebaseapp.com",
  projectId: "sf2x-app",
  storageBucket: "sf2x-app.firebasestorage.app",
  messagingSenderId: "447610198262",
  appId: "1:447610198262:web:1a9576f2d6696518caf4d7",
  measurementId: "G-141DL20YTK"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const urlParams = new URLSearchParams(window.location.search);
const roomParam = urlParams.get('room');

let isLocalMode = !roomParam;
let currentRoom = roomParam || null;
const LOCAL_STORAGE_STATE_KEY = 'sf2x_local_state';

const baseChars = ["リュウ","ケン","本田","春麗","ブランカ","ザンギエフ","ガイル","ダルシム","ホーク","キャミィ","フェイロン","ディージェイ","バイソン","バルログ","サガット","ベガ"];
const allCharacters = baseChars.map((name, i) => ({
  id: `x_${i}`, name: `X ${name}`, icon: `image/x_${i}.png`
}));

const defaultPlayers = ["ウメハラ", "ヌキ", "ハイタニ", "サコー", "ナカム～", "ぐっち", "こたか", "サシシ"];

let appState = {
  masterPlayers: [...defaultPlayers],
  team1Members: [],
  team2Members: [],
  team1Orders: { match: [], bench: [] },
  team2Orders: { match: [], bench: [] },
  slotCount: 16,
  isOrderSet: false,
  allowedCharIds: allCharacters.map(c => c.id)
};

let manualTeams = { "1P": [], "2P": [] };

let currentRole = 'pc_all';
let currentModalTeam = '1';
let sortableInstance = null;
let activeCharTargetInput = null;

function normalizeAppState() {
  if (!appState.slotCount) appState.slotCount = 16;
  if (!appState.masterPlayers || appState.masterPlayers.length === 0) {
    appState.masterPlayers = [...defaultPlayers];
  }
  if (!appState.allowedCharIds || !Array.isArray(appState.allowedCharIds) || appState.allowedCharIds.length === 0) {
    appState.allowedCharIds = allCharacters.map(c => c.id);
  }
  if (Array.isArray(appState.team1Orders)) {
    appState.team1Orders = { match: appState.team1Orders, bench: [] };
  }
  if (Array.isArray(appState.team2Orders)) {
    appState.team2Orders = { match: appState.team2Orders, bench: [] };
  }
}

function loadLocalState() {
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_STATE_KEY);
    if (saved) {
      appState = JSON.parse(saved);
    }
  } catch (e) {}
  normalizeAppState();
}

function hideRoomUIForLocalMode() {
  const roomControls = document.querySelector('.room-header-controls');
  if (roomControls) roomControls.style.display = 'none';

  const deviceRoleSection = document.getElementById('deviceRoleSection');
  if (deviceRoleSection) deviceRoleSection.style.display = 'none';
}

window.onload = function() {
  initSlotSelectOptions();
  initCharPalette();

  if (isLocalMode) {
    hideRoomUIForLocalMode();
    loadLocalState();
    const slotSelect = document.getElementById("slotCountSelect");
    if (slotSelect) slotSelect.value = appState.slotCount;
    updateRuleOptionLabels();
    renderMasterChecklist();
    renderCharBlacklistUI();
    toggleTeamMode();
    renderDisplay();
  } else {
    document.getElementById("currentRoomDisplay").textContent = currentRoom;
    document.getElementById("roomInput").value = currentRoom;

    db.ref(`sf2x_rooms/${currentRoom}`).on('value', (snapshot) => {
      const data = snapshot.val();
      if (data) {
        appState = data;
        normalizeAppState();
        document.getElementById("slotCountSelect").value = appState.slotCount;
        updateRuleOptionLabels();
        renderMasterChecklist();
        renderCharBlacklistUI();
        toggleTeamMode();
        renderDisplay();
      } else {
        syncToFirebase();
      }
    });
  }

  document.addEventListener('click', (e) => {
    const palette = document.getElementById('charPalette');
    if (!e.target.closest('.char-picker-btn') && !e.target.closest('#charPalette')) {
      palette.style.display = 'none';
    }
  });
};

function initSlotSelectOptions() {
  const select = document.getElementById("slotCountSelect");
  select.innerHTML = "";
  for (let i = 2; i <= 16; i++) {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `${i}枠 (${i}キャラ戦)`;
    if (i === 16) opt.selected = true;
    select.appendChild(opt);
  }
}

function syncToFirebase() {
  if (isLocalMode) {
    try {
      localStorage.setItem(LOCAL_STORAGE_STATE_KEY, JSON.stringify(appState));
    } catch (e) {}
    renderMasterChecklist();
    renderCharBlacklistUI();
    renderDisplay();
    return;
  }
  db.ref(`sf2x_rooms/${currentRoom}`).set(appState);
}

function changeRoom() {
  const newRoom = document.getElementById("roomInput").value.trim();
  if (!newRoom) return;
  window.location.href = `${window.location.pathname}?room=${encodeURIComponent(newRoom)}`;
}

function changeSlotCount(count) {
  appState.slotCount = parseInt(count, 10);
  updateRuleOptionLabels();
  syncToFirebase();
}

function updateRuleOptionLabels() {
  const cnt = appState.slotCount || 16;
  const labelFull = document.getElementById("labelFullRandom");
  const labelBoss = document.getElementById("labelBossFixed");
  const labelCounter = document.getElementById("labelCounterPick");
  if (labelFull) labelFull.textContent = `1〜${cnt}人目シャッフル（全員完全ランダム）`;
  if (labelBoss) labelBoss.textContent = `1〜${cnt - 1}人目シャッフル ＋ 大将(${cnt}人目)固定`;
  if (labelCounter) labelCounter.textContent = `先鋒申告 ＋ 2〜${cnt}人目被せ`;
}

function initCharPalette() {
  const palette = document.getElementById('charPalette');
  palette.innerHTML = '';
  allCharacters.forEach(c => {
    const item = document.createElement('div');
    item.className = 'char-palette-item';
    item.title = c.name;
    item.innerHTML = `<img src="${c.icon}" onerror="this.src=''"><span style="font-size:0.65em;">${c.name.replace('X ','')}</span>`;
    item.onclick = () => selectCharFromPalette(c.id);
    palette.appendChild(item);
  });
}

function openCharPalette(e, hiddenInputId) {
  e.stopPropagation();
  activeCharTargetInput = document.getElementById(hiddenInputId);
  const btn = e.currentTarget;
  const palette = document.getElementById('charPalette');
  
  const rect = btn.getBoundingClientRect();
  palette.style.top = `${rect.bottom + window.scrollY + 4}px`;
  palette.style.left = `${Math.min(rect.left + window.scrollX, window.innerWidth - 360)}px`;
  palette.style.display = 'grid';
}

function selectCharFromPalette(charId) {
  if (!activeCharTargetInput) return;
  activeCharTargetInput.value = charId;
  
  const charInfo = allCharacters.find(c => c.id === charId);
  const btn = activeCharTargetInput.nextElementSibling;
  btn.querySelector('img').src = charInfo ? charInfo.icon : '';
  btn.querySelector('span').textContent = charInfo ? charInfo.name : '選択...';

  document.getElementById('charPalette').style.display = 'none';
}

function setDeviceRole(role) {
  currentRole = role;
  const btnP1 = document.getElementById("btnOpenP1");
  const btnP2 = document.getElementById("btnOpenP2");

  if (role === 'p1_only') {
    btnP1.style.display = "block";
    btnP2.style.display = "none";
  } else if (role === 'p2_only') {
    btnP1.style.display = "none";
    btnP2.style.display = "block";
  } else {
    btnP1.style.display = "block";
    btnP2.style.display = "block";
  }
  renderDisplay();
}

function createOrdersEmpty() {
  let orders = [];
  const cnt = appState.slotCount || 16;
  for (let i = 0; i < cnt; i++) {
    orders.push({ name: "", charId: "", revealed: false });
  }
  return { match: orders, bench: [] };
}

function getStorageKey() {
  return `sf2x_checklist_${currentRoom || 'local'}`;
}

function renderMasterChecklist() {
  const container = document.getElementById("masterChecklist");
  if (!container) return;
  container.innerHTML = "";
  if (!appState.masterPlayers) appState.masterPlayers = [...defaultPlayers];

  let savedChecks = {};
  try {
    const saved = localStorage.getItem(getStorageKey());
    if (saved) savedChecks = JSON.parse(saved);
  } catch(e) {}
  
  appState.masterPlayers.forEach((p, idx) => {
    const item = document.createElement("div");
    item.className = "member-item";
    
    let isChecked = (savedChecks[p] !== undefined) ? savedChecks[p] : true;

    item.innerHTML = `
      <label><input type="checkbox" class="player-chk" value="${escapeHTML(p)}" ${isChecked ? 'checked' : ''} onchange="saveChecklistState()"> ${escapeHTML(p)}</label>
      <button class="btn-del" onclick="deletePlayer(${idx})">×</button>
    `;
    container.appendChild(item);
  });
  updateManualTeamLists();
}

function saveChecklistState() {
  let states = {};
  document.querySelectorAll(".player-chk").forEach(cb => {
    states[cb.value] = cb.checked;
  });
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify(states));
  } catch(e) {}
  updateManualTeamLists();
}

function addNewPlayer() {
  const input = document.getElementById("newPlayerInput");
  const name = input.value.trim();
  if (!name) return;
  if (!appState.masterPlayers.includes(name)) {
    appState.masterPlayers.push(name);
    try {
      let saved = JSON.parse(localStorage.getItem(getStorageKey()) || "{}");
      saved[name] = true;
      localStorage.setItem(getStorageKey(), JSON.stringify(saved));
    } catch(e) {}
    syncToFirebase();
  }
  input.value = "";
}

function handleNewPlayerKeyDown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    addNewPlayer();
  }
}

function deletePlayer(index) {
  const pName = appState.masterPlayers[index];
  appState.masterPlayers.splice(index, 1);
  try {
    let saved = JSON.parse(localStorage.getItem(getStorageKey()) || "{}");
    delete saved[pName];
    localStorage.setItem(getStorageKey(), JSON.stringify(saved));
  } catch(e) {}
  syncToFirebase();
}

// -------------------------------------------------------------
// 出現キャラ制限（ブラックリスト）モーダル・設定関連の関数
// -------------------------------------------------------------
function openCharBlacklistModal() {
  renderCharBlacklistUI();
  document.getElementById("charBlacklistModal").style.display = "flex";
}

function closeCharBlacklistModal() {
  document.getElementById("charBlacklistModal").style.display = "none";
}

function renderCharBlacklistUI() {
  const container = document.getElementById("charBlacklistGrid");
  if (!container) return;
  container.innerHTML = "";

  if (!appState.allowedCharIds || appState.allowedCharIds.length === 0) {
    appState.allowedCharIds = allCharacters.map(c => c.id);
  }

  allCharacters.forEach(c => {
    const isChecked = appState.allowedCharIds.includes(c.id);
    const item = document.createElement("div");
    item.className = `char-blacklist-item ${isChecked ? '' : 'is-disabled'}`;
    item.title = c.name;
    item.innerHTML = `
      <input type="checkbox" value="${c.id}" ${isChecked ? 'checked' : ''} onchange="toggleAllowedChar('${c.id}', this.checked)">
      <img src="${c.icon}" onerror="this.src=''">
    `;
    container.appendChild(item);
  });
}

function toggleAllowedChar(charId, isChecked) {
  if (!appState.allowedCharIds) appState.allowedCharIds = [];
  if (isChecked) {
    if (!appState.allowedCharIds.includes(charId)) {
      appState.allowedCharIds.push(charId);
    }
  } else {
    if (appState.allowedCharIds.length <= 1) {
      alert("少なくとも1体以上のキャラクターを選択してください。");
      renderCharBlacklistUI();
      return;
    }
    appState.allowedCharIds = appState.allowedCharIds.filter(id => id !== charId);
  }
  syncToFirebase();
}

function selectAllAllowedChars(enableAll) {
  if (enableAll) {
    appState.allowedCharIds = allCharacters.map(c => c.id);
  } else {
    appState.allowedCharIds = [allCharacters[0].id];
  }
  syncToFirebase();
}

function getAvailableCharacters() {
  // 全員完全ランダム（fullRandom）以外のモードでは、キャラ制限をかけずに全キャラを返す
  const modeElement = document.querySelector('input[name="orderMode"]:checked');
  if (!modeElement || modeElement.value !== 'fullRandom') {
    return allCharacters;
  }

  if (!appState.allowedCharIds || appState.allowedCharIds.length === 0) {
    return allCharacters;
  }
  const filtered = allCharacters.filter(c => appState.allowedCharIds.includes(c.id));
  return filtered.length > 0 ? filtered : allCharacters;
}

// -------------------------------------------------------------
// 手動選択・ドラッグ自由編成モード関連の関数
// -------------------------------------------------------------
function toggleTeamMode() {
  const mode = document.querySelector('input[name="splitMode"]:checked').value;
  const panel = document.getElementById('manualTeamPanel');
  if (mode === 'manual') {
    panel.style.display = 'block';
    const checkboxes = document.querySelectorAll(".player-chk:checked");
    const active = Array.from(checkboxes).map(cb => cb.value);
    
    active.forEach(m => {
      if (!manualTeams['1P'].includes(m) && !manualTeams['2P'].includes(m)) {
        manualTeams['1P'].push(m);
      }
    });
    manualTeams['1P'] = manualTeams['1P'].filter(m => active.includes(m));
    manualTeams['2P'] = manualTeams['2P'].filter(m => active.includes(m));
    updateManualTeamLists();
  } else {
    panel.style.display = 'none';
  }
}

function updateManualTeamLists() {
  const list1 = document.getElementById('manual1pList');
  const list2 = document.getElementById('manual2pList');
  if (!list1 || !list2) return;

  list1.innerHTML = '';
  list2.innerHTML = '';

  manualTeams['1P'].forEach(name => {
    list1.appendChild(createManualCard(name, '1P'));
  });
  manualTeams['2P'].forEach(name => {
    list2.appendChild(createManualCard(name, '2P'));
  });

  const c1 = document.getElementById('manual1pCount');
  const c2 = document.getElementById('manual2pCount');
  if (c1) c1.innerText = manualTeams['1P'].length;
  if (c2) c2.innerText = manualTeams['2P'].length;
}

function createManualCard(name, team) {
  const div = document.createElement('div');
  div.className = 'player-card';
  div.draggable = true;
  div.style.cursor = 'grab';
  div.style.justifyContent = 'space-between';
  div.style.padding = '3px 6px';
  div.style.height = '32px';
  div.style.marginBottom = '2px';

  div.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ name, fromTeam: team }));
  });

  const oppositeTeam = team === '1P' ? '2P' : '1P';
  const arrowIcon = team === '1P' ? '▶' : '◀';

  div.innerHTML = `
    <span style="font-size: 0.85em; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(name)}</span>
    <button type="button" class="btn-arrow" onclick="moveManualMember('${escapeHTML(name)}', '${team}', '${oppositeTeam}')">${arrowIcon}</button>
  `;
  return div;
}

function allowDrop(e) {
  e.preventDefault();
}

function dropToTeam(e, targetTeam) {
  e.preventDefault();
  try {
    const data = JSON.parse(e.dataTransfer.getData('text/plain'));
    moveManualMember(data.name, data.fromTeam, targetTeam);
  } catch(err) {}
}

function moveManualMember(name, fromTeam, toTeam) {
  if (fromTeam === toTeam) return;
  manualTeams[fromTeam] = manualTeams[fromTeam].filter(m => m !== name);
  if (!manualTeams[toTeam].includes(name)) {
    manualTeams[toTeam].push(name);
  }
  updateManualTeamLists();
}

// -------------------------------------------------------------
// チーム自動振り分け
// -------------------------------------------------------------
function makeRandomTeams() {
  const checkboxes = document.querySelectorAll(".player-chk:checked");
  const selectedPlayers = Array.from(checkboxes).map(cb => cb.value);
  if (selectedPlayers.length < 1) {
    alert("参加者を1名以上チェックしてください。");
    return;
  }

  const splitMode = document.querySelector('input[name="splitMode"]:checked').value;

  if (splitMode === 'normal') {
    let shuffled = [...selectedPlayers].sort(() => Math.random() - 0.5);
    const half = Math.ceil(shuffled.length / 2);
    appState.team1Members = shuffled.slice(0, half);
    appState.team2Members = shuffled.slice(half);
  } else if (splitMode === 'manual') {
    appState.team1Members = [...manualTeams['1P']];
    appState.team2Members = [...manualTeams['2P']];
  }

  appState.team1Orders = createOrdersEmpty();
  appState.team2Orders = createOrdersEmpty();
  appState.isOrderSet = false;

  syncToFirebase();
}

function openOrderModal(teamKey) {
  if (currentRole === 'p1_only' && teamKey === '2') return;
  if (currentRole === 'p2_only' && teamKey === '1') return;

  currentModalTeam = teamKey;
  const members = (teamKey === '1') ? appState.team1Members : appState.team2Members;
  const ordersObj = (teamKey === '1') ? appState.team1Orders : appState.team2Orders;
  const slotCount = appState.slotCount || 16;
  
  if (!members || members.length === 0) {
    alert("先にチーム分けを行ってください。");
    return;
  }

  let currentSlots = [...(ordersObj.match || []), ...(ordersObj.bench || [])];
  while (currentSlots.length < slotCount) {
    currentSlots.push({ name: "", charId: "", revealed: false });
  }
  if (currentSlots.length > slotCount) {
    currentSlots = currentSlots.slice(0, slotCount);
  }

  const hasAnyName = currentSlots.some(slot => slot.name !== "");
  if (!hasAnyName) {
    const grouped = generateGroupedPlayerList(members);
    currentSlots.forEach((slot, i) => { slot.name = grouped[i] || ""; });
  }

  document.getElementById("modalTitle").textContent = `${teamKey === '1' ? '🔴 1Pチーム' : '🔵 2Pチーム'} オーダー設定 (${slotCount}枠)`;
  
  const modeElement = document.querySelector('input[name="orderMode"]:checked');
  const isFullRandom = modeElement && modeElement.value === 'fullRandom';
  
  const fillBtn = document.getElementById("btnFillAll");
  if (fillBtn) {
    fillBtn.style.display = isFullRandom ? "none" : "inline-block";
  }

  const blacklistBtn = document.getElementById("btnModalCharBlacklist");
  if (blacklistBtn) {
    blacklistBtn.style.display = isFullRandom ? "inline-block" : "none";
  }

  renderModalRows(members, currentSlots, isFullRandom);
  updateModalLabels();
  document.getElementById("orderModal").style.display = "flex";

  const el = document.getElementById('modalOrderRows');
  if (sortableInstance) sortableInstance.destroy();
  sortableInstance = new Sortable(el, {
    handle: '.drag-handle',
    animation: 150,
    onEnd: function() {
      updateModalLabels();
    }
  });
}

function generateGroupedPlayerList(members) {
  const slotCount = appState.slotCount || 16;
  const mCount = members.length;
  if (mCount === 0) return Array(slotCount).fill("");

  const baseCount = Math.floor(slotCount / mCount);
  const remainder = slotCount % mCount;

  let result = [];
  members.forEach((m, idx) => {
    const count = baseCount + (idx < remainder ? 1 : 0);
    for (let i = 0; i < count; i++) {
      result.push(m);
    }
  });
  return result;
}

function autoFillGroupedPlayers() {
  const members = (currentModalTeam === '1') ? appState.team1Members : appState.team2Members;
  if (!members || members.length === 0) return;

  const grouped = generateGroupedPlayerList(members);
  const rows = document.querySelectorAll("#modalOrderRows .order-row");

  rows.forEach((row, idx) => {
    row.querySelector(".m-name").value = grouped[idx] || "";
  });
}

function renderModalRows(members, orders, isFullRandom = false) {
  const container = document.getElementById("modalOrderRows");
  container.innerHTML = "";

  orders.forEach((slot, idx) => {
    const row = document.createElement("div");
    row.className = "order-row";

    let nameOptions = `<option value="">-- 選択 --</option>` + members.map(p => 
      `<option value="${escapeHTML(p)}" ${p === slot.name ? 'selected' : ''}>${escapeHTML(p)}</option>`
    ).join("");

    const charInfo = allCharacters.find(c => c.id === slot.charId);

    if (isFullRandom) {
      row.innerHTML = `
        <span class="drag-handle">☰</span>
        <div class="arrow-group">
          <button type="button" class="btn-arrow" onclick="moveRowUp(this)">▲</button>
          <button type="button" class="btn-arrow" onclick="moveRowDown(this)">▼</button>
        </div>
        <span class="slot-label" style="width:125px; font-size:0.9em;"><b>${idx + 1}人目:</b></span>
        <select class="m-name" style="flex:1;">${nameOptions}</select>
        <input type="hidden" class="m-char" value="">
        <span style="font-size:0.85em; color:#888; padding:4px 8px;">(許可キャラから自動)</span>
      `;
    } else {
      row.innerHTML = `
        <span class="drag-handle">☰</span>
        <div class="arrow-group">
          <button type="button" class="btn-arrow" onclick="moveRowUp(this)">▲</button>
          <button type="button" class="btn-arrow" onclick="moveRowDown(this)">▼</button>
        </div>
        <span class="slot-label" style="width:125px; font-size:0.9em;"><b>${idx + 1}人目:</b></span>
        <select
