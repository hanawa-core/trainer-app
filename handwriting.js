// 手書き認識モジュール
// .hw-target クラスの input/textarea をタップで自動的に手書きモーダルを開く

let hwTargetId = null;
let hwRecognizer = null;
let hwDrawing = false;
let hwStrokes = [];
let hwCurrentPoints = [];
let hwCtx = null;
let hwCanvas = null;
let hwConfirmedText = '';
let hwRecognizeTimer = null;

async function initHandwriting() {
  hwCanvas = document.getElementById('hw-canvas');
  hwCtx = hwCanvas.getContext('2d');

  resizeCanvas();

  hwCanvas.addEventListener('pointerdown', hwPointerDown, { passive: false });
  hwCanvas.addEventListener('pointermove', hwPointerMove, { passive: false });
  hwCanvas.addEventListener('pointerup', hwPointerUp, { passive: false });
  hwCanvas.addEventListener('pointercancel', hwPointerUp, { passive: false });

  if ('createHandwritingRecognizer' in navigator) {
    try {
      hwRecognizer = await navigator.createHandwritingRecognizer({ languages: ['ja'] });
    } catch (e) {
      console.warn('Handwriting API 利用不可:', e);
    }
  }

  // .hw-target を持つ要素のタップ→自動モーダル
  document.addEventListener('click', (e) => {
    const el = e.target.closest('.hw-target');
    if (el && !el.dataset.hwSkip) {
      e.preventDefault();
      openHWFor(el);
    }
  });
}

function resizeCanvas() {
  const rect = hwCanvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  hwCanvas.width = rect.width * dpr;
  hwCanvas.height = 200 * dpr;
  hwCtx.setTransform(1, 0, 0, 1, 0, 0);
  hwCtx.scale(dpr, dpr);
  hwCtx.strokeStyle = '#1e293b';
  hwCtx.lineWidth = 3;
  hwCtx.lineCap = 'round';
  hwCtx.lineJoin = 'round';
}

function getPos(e) {
  const rect = hwCanvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top, t: Date.now() };
}

function hwPointerDown(e) {
  e.preventDefault();
  hwDrawing = true;
  hwCurrentPoints = [];
  const pos = getPos(e);
  hwCurrentPoints.push(pos);
  hwCtx.beginPath();
  hwCtx.moveTo(pos.x, pos.y);
  hwCanvas.setPointerCapture(e.pointerId);
}

function hwPointerMove(e) {
  if (!hwDrawing) return;
  e.preventDefault();
  const pos = getPos(e);
  hwCurrentPoints.push(pos);
  hwCtx.lineTo(pos.x, pos.y);
  hwCtx.stroke();
}

function hwPointerUp(e) {
  if (!hwDrawing) return;
  hwDrawing = false;
  if (hwCurrentPoints.length > 0) {
    hwStrokes.push([...hwCurrentPoints]);
    hwCurrentPoints = [];
    // 少し遅延させて認識（連続書きを考慮）
    clearTimeout(hwRecognizeTimer);
    hwRecognizeTimer = setTimeout(recognize, 400);
  }
}

async function recognize() {
  if (hwStrokes.length === 0) return;

  if (!hwRecognizer) {
    document.getElementById('hw-result').textContent = '（認識API未対応。キーボードボタンで入力してください）';
    return;
  }

  try {
    const drawing = hwRecognizer.startDrawing();
    for (const stroke of hwStrokes) {
      const s = new HandwritingStroke();
      for (const pt of stroke) {
        s.addPoint({ x: pt.x, y: pt.y, t: pt.t });
      }
      drawing.addStroke(s);
    }
    const results = await drawing.getPrediction();
    drawing.clear();

    if (results && results.length > 0) {
      hwConfirmedText = results[0].text;
      document.getElementById('hw-result').textContent = results[0].text;

      const candidateEl = document.getElementById('hw-candidates');
      candidateEl.innerHTML = '';
      results.slice(0, 5).forEach(r => {
        const btn = document.createElement('button');
        btn.className = 'hw-candidate';
        btn.textContent = r.text;
        btn.onclick = () => {
          hwConfirmedText = r.text;
          document.getElementById('hw-result').textContent = r.text;
        };
        candidateEl.appendChild(btn);
      });
    }
  } catch (e) {
    console.error('認識エラー:', e);
    document.getElementById('hw-result').textContent = '認識エラー';
  }
}

function clearCanvas() {
  hwCtx.clearRect(0, 0, hwCanvas.width, hwCanvas.height);
  hwStrokes = [];
  hwCurrentPoints = [];
  hwConfirmedText = '';
  document.getElementById('hw-result').textContent = 'ここに書いてください';
  document.getElementById('hw-candidates').innerHTML = '';
}

function openHWFor(el) {
  hwTargetId = el.id;
  if (!hwTargetId) {
    hwTargetId = 'hw-tmp-' + Math.random().toString(36).slice(2, 8);
    el.id = hwTargetId;
  }
  const hint = el.dataset.hwHint || 'テキスト';
  const label = el.previousElementSibling && el.previousElementSibling.tagName === 'LABEL'
    ? el.previousElementSibling.textContent
    : (el.placeholder || '入力');

  hwStrokes = [];
  hwConfirmedText = '';
  document.getElementById('hw-title').textContent = label;
  document.getElementById('hw-result').textContent = 'ここに書いてください';
  document.getElementById('hw-candidates').innerHTML = '';

  document.getElementById('modal-hw').classList.add('open');
  setTimeout(resizeCanvas, 50);
}

// 後方互換用
function openHW(targetId, hint) {
  const el = document.getElementById(targetId);
  if (el) openHWFor(el);
}

function closeHW() {
  document.getElementById('modal-hw').classList.remove('open');
  clearCanvas();
  hwTargetId = null;
}

function confirmHW() {
  if (!hwTargetId) return;
  const el = document.getElementById(hwTargetId);
  if (el && hwConfirmedText) {
    if (el.tagName === 'TEXTAREA') {
      el.value = (el.value ? el.value + '\n' : '') + hwConfirmedText;
    } else {
      el.value = hwConfirmedText;
    }
    el.dispatchEvent(new Event('input'));
  }
  closeHW();
}

// キーボード入力モード（一時的に手書きをスキップ）
function useKeyboard() {
  if (!hwTargetId) return;
  const el = document.getElementById(hwTargetId);
  closeHW();
  if (el) {
    el.dataset.hwSkip = '1';
    el.focus();
    setTimeout(() => { delete el.dataset.hwSkip; }, 100);
  }
}

window.addEventListener('DOMContentLoaded', initHandwriting);
