// ==========================================
// スパ2X キャラ戦 チーム管理＆OBSツール - script.js (分割版・修正済み)
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

// room パラメータが無い場合は「ローカルモード」で起動する。
// ローカルモードは Firebase を一切経由せず、このブラウザタブの中だけで完結する。
// 友人に配る用の通常URL → ローカルモード（お互いに影響しない）
// 自分用の ?room=好きな名前 付きURL → 今まで通りFirebase同期モード
let isLocalMode = !roomParam;
let currentRoom = roomParam || null;
const LOCAL_STORAGE_STATE_KEY = 'sf2x_local_state';

const baseChars = ["リュウ","ケン","本田","春麗","ブランカ","ザンギエフ","ガイル","ダルシム","ホーク","キャミィ","フェイロン","ディージェイ","バイソン","バルログ","サガット","ベガ"];
const allCharacters = baseChars.map((name, i) => ({
  id: `x_${i}`, name: `X ${name}`, icon: `image/x_${i}.png`
}));

const defaultPlayers = ["ウメハラ", "ヌキ", "ハイタニ", "サコー", "ナカム～", "ぐっち", "こたか", "サシシ"];

// 公平なシャッフル（Fisher-Yates）。
// sort(() => Math.random() - 0.5) は分布が偏るため、ランダム抽選が絡む箇所では
// すべてこの関数を使う。
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let appState = {
  masterPlayers: [...defaultPlayers],
  team1Members: [],
  team2Members: [],
  team1Orders: { match: [], bench: [] },
  team2Orders: { match: [], bench: [] },
  slotCount: 16,
  isOrderSet: false
};

let currentRole = 'pc_all';
let currentModalTeam = '1';
let sortableInstance = null;
let activeCharTargetInput = null;

// appState の形が古いデータや空データでも壊れないように整える共通処理
// （Firebaseモード／ローカルモードの両方から呼ばれる）
function normalizeAppState() {
  if (!appState.slotCount) appState.slotCount = 16;
  if (!appState.masterPlayers || appState.masterPlayers.length === 0) {
    appState.masterPlayers = [...defaultPlayers];
  }
  if (Array.isArray(appState.team1Orders)) {
    appState.team1Orders = { match: appState.team1Orders, bench: [] };
  }
  if (Array.isArray(appState.team2Orders)) {
    appState.team2Orders = { match: appState.team2Orders, bench: [] };
  }
}

// ローカルモード用: 前回リロード前の状態を localStorage から復元する
function loadLocalState() {
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_STATE_KEY);
    if (saved) {
      appState = JSON.parse(saved);
    }
  } catch (e) {}
  normalizeAppState();
}

// ローカルモード用: 他端末との同期が前提のUI（部屋表示・端末別入力モード設定）を隠す
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
    // Firebaseを経由せず、このタブの中だけで保存・再描画する
    try {
      localStorage.setItem(LOCAL_STORAGE_STATE_KEY, JSON.stringify(appState));
    } catch (e) {}
    renderMasterChecklist();
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
}

function saveChecklistState() {
  let states = {};
  document.querySelectorAll(".player-chk").forEach(cb => {
    states[cb.value] = cb.checked;
  });
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify(states));
  } catch(e) {}
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

function makeRandomTeams() {
  const checkboxes = document.querySelectorAll(".player-chk:checked");
  const selectedPlayers = Array.from(checkboxes).map(cb => cb.value);
  if (selectedPlayers.length < 2) {
    alert("2名以上チェックしてください。");
    return;
  }

  const splitMode = document.querySelector('input[name="splitMode"]:checked').value;
  let shuffled = shuffleArray(selectedPlayers);

  if (splitMode === 'handicap1_p1') {
    appState.team1Members = [shuffled[0]];
    appState.team2Members = shuffled.slice(1);
  } else if (splitMode === 'handicap1_p2') {
    appState.team1Members = shuffled.slice(1);
    appState.team2Members = [shuffled[0]];
  } else {
    const half = Math.ceil(shuffled.length / 2);
    appState.team1Members = shuffled.slice(0, half);
    appState.team2Members = shuffled.slice(half);
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
        <span style="font-size:0.85em; color:#888; padding:4px 8px;">(キャラ自動割振)</span>
      `;
    } else {
      row.innerHTML = `
        <span class="drag-handle">☰</span>
        <div class="arrow-group">
          <button type="button" class="btn-arrow" onclick="moveRowUp(this)">▲</button>
          <button type="button" class="btn-arrow" onclick="moveRowDown(this)">▼</button>
        </div>
        <span class="slot-label" style="width:125px; font-size:0.9em;"><b>${idx + 1}人目:</b></span>
        <select class="m-name" style="flex:1;">${nameOptions}</select>
        
        <input type="hidden" class="m-char" id="char_input_${idx}" value="${slot.charId || ''}">
        <div class="char-picker-btn" onclick="openCharPalette(event, 'char_input_${idx}')">
          <img class="char-face" src="${charInfo ? charInfo.icon : ''}" onerror="this.src=''">
          <span style="font-size:0.85em; flex:1;">${charInfo ? charInfo.name : 'キャラ選択...'}</span>
        </div>
      `;
    }
    container.appendChild(row);
  });
}

function moveRowUp(btn) {
  const row = btn.closest('.order-row');
  const prevRow = row.previousElementSibling;
  if (prevRow) {
    row.parentNode.insertBefore(row, prevRow);
    updateModalLabels();
  }
}

function moveRowDown(btn) {
  const row = btn.closest('.order-row');
  const nextRow = row.nextElementSibling;
  if (nextRow) {
    row.parentNode.insertBefore(nextRow, row);
    updateModalLabels();
  }
}

function updateModalLabels() {
  const modeElement = document.querySelector('input[name="orderMode"]:checked');
  if (!modeElement) return;
  const mode = modeElement.value;
  const labels = document.querySelectorAll(".slot-label");
  const slotCount = appState.slotCount || 16;

  labels.forEach((label, idx) => {
    if (mode === 'counterPick' && idx === 0) {
      label.innerHTML = `<b>1人目 <span style="color:#ff9f1c;">(先鋒申告)</span>:</b>`;
    } else if (mode === 'bossFixed' && idx === slotCount - 1) {
      label.innerHTML = `<b>${slotCount}人目 <span style="color:#ff9f1c;">(大将固定)</span>:</b>`;
    } else {
      label.innerHTML = `<b>${idx + 1}人目:</b>`;
    }
  });
}

function fillFullRandomModal() {
  const members = (currentModalTeam === '1') ? appState.team1Members : appState.team2Members;
  if (!members || members.length === 0) return;

  const rows = document.querySelectorAll("#modalOrderRows .order-row");
  const slotCount = appState.slotCount || 16;
  
  let playerPool = [];
  while (playerPool.length < slotCount) {
    let shuffledMembers = shuffleArray(members);
    playerPool = playerPool.concat(shuffledMembers);
  }
  playerPool = playerPool.slice(0, slotCount);

  let shuffledChars = shuffleArray(allCharacters);

  rows.forEach((row, idx) => {
    row.querySelector(".m-name").value = playerPool[idx];
    
    const charInput = row.querySelector(".m-char");
    if (charInput) {
      const charBtn = row.querySelector(".char-picker-btn");
      const chosenChar = shuffledChars[idx % shuffledChars.length];

      charInput.value = chosenChar.id;
      if (charBtn) {
        charBtn.querySelector('img').src = chosenChar.icon;
        charBtn.querySelector('span').textContent = chosenChar.name;
      }
    }
  });
}

function saveOrderModal() {
  const mode = document.querySelector('input[name="orderMode"]:checked').value;
  const targetOrders = (currentModalTeam === '1') ? appState.team1Orders : appState.team2Orders;
  const rows = document.querySelectorAll("#modalOrderRows .order-row");
  const slotCount = appState.slotCount || 16;

  let tempSelections = [];
  rows.forEach((row) => {
    const charInput = row.querySelector(".m-char");
    tempSelections.push({
      name: row.querySelector(".m-name").value,
      charId: charInput ? charInput.value : "",
      revealed: false
    });
  });

  if (mode !== 'fullRandom') {
    let charCounts = {};
    let duplicateChars = [];
    tempSelections.forEach(slot => {
      if (slot.charId) {
        charCounts[slot.charId] = (charCounts[slot.charId] || 0) + 1;
        if (charCounts[slot.charId] === 2) {
          const cObj = allCharacters.find(c => c.id === slot.charId);
          duplicateChars.push(cObj ? cObj.name : slot.charId);
        }
      }
    });

    if (duplicateChars.length > 0) {
      let charNamesStr = duplicateChars.join("、");
      let ok = confirm(`【注意】同じキャラクター（${charNamesStr} など）が2体以上選択されています。\n\nこのまま設定を完了してもよろしいですか？`);
      if (!ok) {
        return;
      }
    }
  }

  if (mode === 'counterPick') {
    tempSelections[0].revealed = true;
    for (let i = 1; i < tempSelections.length; i++) {
      tempSelections[i].revealed = false;
    }
    targetOrders.match = [tempSelections[0]];
    targetOrders.bench = tempSelections.slice(1);
  } else if (mode === 'bossFixed') {
    let topN = shuffleArray(tempSelections.slice(0, slotCount - 1));
    let finalOrder = [...topN, tempSelections[slotCount - 1]];
    finalOrder.forEach(slot => slot.revealed = false);
    targetOrders.match = finalOrder;
    targetOrders.bench = [];
  } else if (mode === 'fullRandom') {
    let shuffledChars = shuffleArray(allCharacters);
    let fullRandomOrder = tempSelections.map((slot, idx) => {
      const chosenChar = shuffledChars[idx % shuffledChars.length];
      return {
        name: slot.name,
        charId: chosenChar.id,
        revealed: false
      };
    });
    targetOrders.match = fullRandomOrder;
    targetOrders.bench = [];
  } else {
    targetOrders.match = tempSelections;
    targetOrders.bench = [];
  }

  appState.isOrderSet = true;
  closeOrderModal();
  syncToFirebase();
}

function closeOrderModal() {
  document.getElementById("orderModal").style.display = "none";
}

function handleImgError(img) {
  img.classList.add('load-error');
}

function moveBenchToMatch(teamKey, benchIndex) {
  const targetOrders = (teamKey === '1') ? appState.team1Orders : appState.team2Orders;
  if (!targetOrders.bench || !targetOrders.bench[benchIndex]) return;

  const movedChar = targetOrders.bench.splice(benchIndex, 1)[0];
  movedChar.revealed = true;
  targetOrders.match.push(movedChar);

  syncToFirebase();
}

function moveMatchToBench(teamKey, matchIndex) {
  const targetOrders = (teamKey === '1') ? appState.team1Orders : appState.team2Orders;
  if (!targetOrders.match || !targetOrders.match[matchIndex]) return;

  const movedChar = targetOrders.match.splice(matchIndex, 1)[0];
  movedChar.revealed = false;
  if (!targetOrders.bench) targetOrders.bench = [];
  targetOrders.bench.push(movedChar);

  syncToFirebase();
}

function renderDisplay() {
  renderTeamDisplay('1', appState.team1Members, appState.team1Orders);
  renderTeamDisplay('2', appState.team2Members, appState.team2Orders);
}

// -------------------------------------------------------------
// 旧アプリの正しい描画ロジックをベースに完全に復元した関数
// -------------------------------------------------------------
function renderTeamDisplay(teamKey, members, ordersObj) {
  const matchContainer = document.getElementById(`team${teamKey}-match-display`);
  const benchContainer = document.getElementById(`team${teamKey}-bench-display`);
  if (!matchContainer || !benchContainer) return;

  matchContainer.innerHTML = "";
  benchContainer.innerHTML = "";

  if ((currentRole === 'p1_only' && teamKey === '2') || (currentRole === 'p2_only' && teamKey === '1')) {
    matchContainer.innerHTML = `<div style="padding:20px; text-align:center; color:#666;">（非表示）</div>`;
    benchContainer.innerHTML = `<div style="padding:20px; text-align:center; color:#666;">（非表示）</div>`;
    return;
  }

  const faceClass = (teamKey === '2') ? "char-face p2-face" : "char-face";
  const modeElement = document.querySelector('input[name="orderMode"]:checked');
  const isCounterPickMode = modeElement && modeElement.value === 'counterPick';

  if (!appState.isOrderSet) {
    if (members) {
      members.forEach((name, idx) => {
        const card = document.createElement("div");
        card.className = "player-card";
        card.innerHTML = `<span class="order-num">${idx + 1}.</span><div class="player-info"><div class="player-name">${escapeHTML(name)}</div></div>`;
        matchContainer.appendChild(card);
      });
    }
  } else {
    if (ordersObj.match) {
      ordersObj.match.forEach((slot, idx) => {
        const card = document.createElement("div");
        const charInfo = allCharacters.find(c => c.id === slot.charId) || { name: "未選択", icon: "" };
        card.className = `player-card ${slot.revealed ? '' : 'is-hidden'}`;
        
        if (slot.revealed) {
          card.innerHTML = `
            <span class="order-num">${idx + 1}.</span>
            <img class="${faceClass}" src="${charInfo.icon}" onerror="handleImgError(this)">
            <div class="player-info">
              <div class="player-name" title="${escapeHTML(slot.name)}">${slot.name ? escapeHTML(slot.name) : '未設定'}</div>
              <div class="char-name">${charInfo.name}</div>
            </div>
          `;
        } else {
          // 未選択・非公開のときは旧アプリ同様に「？？？」「（伏せ）」と secret.png を使う
          card.innerHTML = `
            <span class="order-num">${idx + 1}.</span>
            <img class="${faceClass}" src="image/secret.png" onerror="handleImgError(this)">
            <div class="player-info">
              <div class="player-name">？？？</div>
              <div class="char-name">（伏せ）</div>
            </div>
          `;
        }

        card.onclick = () => {
          if (isCounterPickMode && idx > 0) {
            moveMatchToBench(teamKey, idx);
          } else {
            slot.revealed = !slot.revealed;
            syncToFirebase();
          }
        };

        matchContainer.appendChild(card);
      });
    }

    if (ordersObj.bench) {
      ordersObj.bench.forEach((slot, idx) => {
        const card = document.createElement("div");
        const charInfo = allCharacters.find(c => c.id === slot.charId) || { name: "未選択", icon: "" };
        card.className = "player-card";
        
        card.innerHTML = `
          <img class="${faceClass}" src="${charInfo.icon}" onerror="handleImgError(this)">
          <div class="player-info">
            <div class="player-name" title="${escapeHTML(slot.name)}">${slot.name ? escapeHTML(slot.name) : '未設定'}</div>
            <div class="char-name">${charInfo.name}</div>
          </div>
        `;

        card.onclick = () => {
          moveBenchToMatch(teamKey, idx);
        };

        benchContainer.appendChild(card);
      });
    }
  }
}

function escapeHTML(str) {
  if (!str) return "";
  return str.replace(/[&<>"']/g, function(m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
  });
}
