const { chromium } = require("playwright");

/**
 * CGV 용산 IMAX 자동 예매 보조
 *
 * 기본 설정:
 * - 영화: 오디세이 (movNo=30001323)
 * - 극장: CGV 용산아이파크몰 (siteNo=0013)
 * - 상영관: IMAX관 (scnsNo=018)
 * - 날짜: 2026-08-26
 * - 회차: 4회차
 * - 인원: 2명
 * - 좌석 우선순위:
 *   J20-21 → I20-21 → L20-21 →
 *   J19-20 → I19-20 → L19-20 →
 *   J21-22 → ...
 *
 * 결제 자체는 자동으로 진행하지 않습니다.
 * CAPTCHA/추가 인증이 나타나면 직접 처리해야 합니다.
 */

const CONFIG = {
  coCd: "A420",
  siteNo: "0013",
  scnsNo: "018",
  movNo: "30001323",
  scnYmd: "20260826",
  scnSseq: "4",

  rowPriority: ["J", "I", "L"],
  centerLeft: 20,
  maxDistance: 15,

  scheduleIntervalMs: 5000,
  controlIntervalMs: 2000,
  domTimeoutMs: 30000,

  bookingUrl: "https://cgv.co.kr/cnm/movieBook/movie",
  userDataDir: "./browser-data",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function now() {
  return new Date().toLocaleTimeString("ko-KR");
}

function log(...args) {
  console.log(`[CGV ${now()}]`, ...args);
}

function alarm() {
  // 터미널 벨
  process.stdout.write("\x07");
}

async function jsonOrThrow(response, name) {
  if (!response.ok()) {
    const body = await response.text().catch(() => "");
    throw new Error(`${name} HTTP ${response.status()} ${body.slice(0, 300)}`);
  }
  return response.json();
}

/* ------------------------------------------------------------------ */
/* 1. 상영 편성 조회                                                    */
/* ------------------------------------------------------------------ */

async function searchSchedule(context) {
  const params = new URLSearchParams({
    coCd: CONFIG.coCd,
    siteNo: CONFIG.siteNo,
    scnYmd: CONFIG.scnYmd,
    movNo: CONFIG.movNo,
    rtctlScopCd: "08",
  });

  const response = await context.request.get(
    `https://cgv.co.kr/api/v1/booking/searchSchByMov?${params.toString()}`,
    {
      headers: {
        accept: "application/json",
        "cache-control": "no-cache",
        pragma: "no-cache",
      },
    }
  );

  const result = await jsonOrThrow(response, "searchSchByMov");

  if (!Array.isArray(result.data)) return null;

  return (
    result.data.find(
      (item) =>
        String(item.siteNo) === CONFIG.siteNo &&
        String(item.scnsNo) === CONFIG.scnsNo &&
        String(item.scnSseq) === CONFIG.scnSseq
    ) || null
  );
}

/* ------------------------------------------------------------------ */
/* 2. 예매준비중 여부 조회                                               */
/* ------------------------------------------------------------------ */

async function searchControl(context) {
  const params = new URLSearchParams({
    coCd: CONFIG.coCd,
    siteNo: CONFIG.siteNo,
    scnYmd: CONFIG.scnYmd,
    scnsNo: CONFIG.scnsNo,
    scnSseq: CONFIG.scnSseq,
    rtctlScopCd: "08",
  });

  const response = await context.request.get(
    `https://api.cgv.co.kr/com/bznsCom/mov/searchRtktCntlYn?${params.toString()}`,
    {
      headers: {
        accept: "application/json",
        "cache-control": "no-cache",
        pragma: "no-cache",
      },
    }
  );

  const result = await jsonOrThrow(response, "searchRtktCntlYn");
  return result?.data?.rtktCntlYn;
}

async function waitForOpening(context) {
  log("8/26 용산 IMAX 오디세이 4회차 감시 시작");

  let schedule = null;

  while (!schedule) {
    try {
      schedule = await searchSchedule(context);

      if (!schedule) {
        log("아직 IMAX 4회차 없음");
        await sleep(CONFIG.scheduleIntervalMs);
      }
    } catch (err) {
      console.error("[편성 조회 오류]", err.message);
      await sleep(CONFIG.scheduleIntervalMs);
    }
  }

  alarm();
  log(
    `🚨 4회차 발견: ${schedule.scnYmd} ${schedule.scnsrtTm}~${schedule.scnendTm}`,
    schedule.movNm || ""
  );

  while (true) {
    try {
      const control = await searchControl(context);
      log("rtktCntlYn =", control);

      if (control === "N") {
        alarm();
        alarm();
        log("🚨 예매 가능 상태 감지");
        return schedule;
      }
    } catch (err) {
      console.error("[통제 조회 오류]", err.message);
    }

    await sleep(CONFIG.controlIntervalMs);
  }
}

/* ------------------------------------------------------------------ */
/* 로그인                                                              */
/* ------------------------------------------------------------------ */

async function clickLoginModalIfPresent(page) {
  const modal = page
    .locator('.cgv-modal[role="dialog"]')
    .filter({ hasText: "CGV 회원 로그인이 필요한 서비스" });

  if ((await modal.count()) === 0) return false;

  const confirm = modal.getByRole("button", { name: "확인", exact: true });
  if ((await confirm.count()) === 0) return false;

  log("로그인 안내 모달 → [확인]");
  await confirm.click();
  return true;
}

async function waitForManualLoginIfNeeded(page) {
  // 로그인 URL로 넘어왔거나 CAPTCHA input이 보이면 수동 로그인을 기다린다.
  const captcha = page.locator('input#loginInput3[name="captcha"]');

  const isLoginPage =
    page.url().includes("/mem/login") || (await captcha.count()) > 0;

  if (!isLoginPage) return false;

  alarm();
  log("🔐 로그인이 필요합니다.");
  log("브라우저에서 ID/PW 및 자동입력 방지문자를 직접 입력해 로그인하세요.");
  log("로그인 완료를 최대 5분 기다립니다.");

  await page
    .waitForURL((url) => !url.pathname.includes("/mem/login"), {
      timeout: 5 * 60 * 1000,
    })
    .catch(() => {});

  if (page.url().includes("/mem/login")) {
    throw new Error("5분 안에 로그인이 완료되지 않았습니다.");
  }

  log("✅ 로그인 완료 감지");
  return true;
}

/* ------------------------------------------------------------------ */
/* 4회차 버튼 찾기                                                      */
/* ------------------------------------------------------------------ */

function formatStartTime(schedule) {
  const raw = String(schedule.scnsrtTm || "").padStart(4, "0");
  return `${raw.slice(0, 2)}:${raw.slice(2, 4)}`;
}

async function findRoundButton(page, schedule) {
  const targetTime = formatStartTime(schedule);

  const buttons = page.locator('button[class*="screenInfo_timelink"]');
  const count = await buttons.count();

  for (let i = 0; i < count; i++) {
    const button = buttons.nth(i);

    if (!(await button.isVisible()).catch(() => false)) continue;
    if (!(await button.isEnabled()).catch(() => false)) continue;

    const ariaDisabled = await button.getAttribute("aria-disabled");
    if (ariaDisabled === "true") continue;

    const start = button.locator('span[class*="screenInfo_start"]');
    if ((await start.count()) === 0) continue;

    const startText = (await start.first().textContent())?.trim();
    if (startText !== targetTime) continue;

    // 동일 시간이 다른 상영관에도 있을 수 있으므로 상위 DOM에서 IMAX 텍스트를 우선 확인.
    const isImax = await button.evaluate((el) => {
      let p = el;
      for (let depth = 0; depth < 12 && p; depth++, p = p.parentElement) {
        const text = (p.textContent || "").replace(/\s+/g, "").toUpperCase();
        if (text.includes("IMAX") || text.includes("아이맥스")) return true;
      }
      return false;
    });

    if (isImax) return button;
  }

  // 페이지가 이미 IMAX로 필터된 상태라 부모에 IMAX 글자가 없을 수 있는 경우 fallback.
  for (let i = 0; i < count; i++) {
    const button = buttons.nth(i);
    if (!(await button.isVisible()).catch(() => false)) continue;
    if (!(await button.isEnabled()).catch(() => false)) continue;

    const start = button.locator('span[class*="screenInfo_start"]');
    if ((await start.count()) === 0) continue;

    const startText = (await start.first().textContent())?.trim();
    if (startText === targetTime) return button;
  }

  return null;
}

async function gotoBookingPage(page) {
  const params = new URLSearchParams({
    movNo: CONFIG.movNo,
    siteNo: CONFIG.siteNo,
    scnYmd: CONFIG.scnYmd,
  });

  await page.goto(`${CONFIG.bookingUrl}?${params.toString()}`, {
    waitUntil: "domcontentloaded",
  });

  await page.waitForTimeout(700);
}

async function enterRound(page, schedule) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    log(`예매 화면에서 4회차 탐색 (${attempt}/3)`);

    const deadline = Date.now() + CONFIG.domTimeoutMs;
    let roundButton = null;

    while (Date.now() < deadline && !roundButton) {
      roundButton = await findRoundButton(page, schedule);
      if (!roundButton) await sleep(200);
    }

    if (!roundButton) {
      if (attempt < 3) {
        await gotoBookingPage(page);
        continue;
      }
      throw new Error(`IMAX ${formatStartTime(schedule)} 회차 버튼을 찾지 못했습니다.`);
    }

    log(`✅ IMAX ${formatStartTime(schedule)} 회차 클릭`);
    await roundButton.click();

    await page.waitForTimeout(400);
    await clickLoginModalIfPresent(page);

    // 로그인 페이지로 넘어갈 시간을 조금 준다.
    await page.waitForTimeout(500);

    const didLogin = await waitForManualLoginIfNeeded(page);

    if (didLogin) {
      // 로그인 후 예매 흐름이 초기화될 수 있으므로 페이지부터 다시 진입한다.
      await gotoBookingPage(page);
      continue;
    }

    return;
  }

  throw new Error("4회차 진입에 실패했습니다.");
}

/* ------------------------------------------------------------------ */
/* 인원 2명 → 좌석 선택 화면                                            */
/* ------------------------------------------------------------------ */

async function selectTwoPeople(page) {
  log("인원 2명 버튼 대기");

  const button = page.locator('button[aria-label="2 선택"]').first();

  await button.waitFor({
    state: "visible",
    timeout: CONFIG.domTimeoutMs,
  });

  await button.click();
  log("✅ 2명 선택");

  const selectButton = page.getByRole("button", {
    name: "선택",
    exact: true,
  });

  await selectButton.waitFor({
    state: "visible",
    timeout: CONFIG.domTimeoutMs,
  });

  log("✅ 좌석 선택 화면 열기");
  await selectButton.click();
}

/* ------------------------------------------------------------------ */
/* 좌석 탐색                                                            */
/* ------------------------------------------------------------------ */

function generateOffsets() {
  const offsets = [0];

  for (let d = 1; d <= CONFIG.maxDistance; d++) {
    offsets.push(-d);
    offsets.push(d);
  }

  return offsets;
}

function seatName(row, number) {
  return `${row}${number}`;
}

function seatLocator(page, row, number) {
  const name = seatName(row, number);

  // CSS class 해시에 의존하지 않고 data-seatlocno + 표시 문자열로 찾는다.
  return page
    .locator("button[data-seatlocno]")
    .filter({ hasText: name })
    .filter({
      has: page.locator("span", { hasText: name }),
    })
    .first();
}

async function seatAvailable(locator) {
  if ((await locator.count()) === 0) return false;
  if (!(await locator.isVisible()).catch(() => false)) return false;
  if (!(await locator.isEnabled()).catch(() => false)) return false;

  const disabled = await locator.getAttribute("disabled");
  const ariaDisabled = await locator.getAttribute("aria-disabled");

  return disabled === null && ariaDisabled !== "true";
}

async function seatsAreAdjacent(left, right) {
  const a = await left.boundingBox();
  const b = await right.boundingBox();

  if (!a || !b) return false;

  const sameRow = Math.abs(a.y - b.y) <= 5;
  const xDistance = Math.abs(b.x - a.x);
  const maxDistance = Math.max(a.width, b.width) * 1.65;

  return sameRow && xDistance <= maxDistance;
}

async function findBestPair(page) {
  for (const offset of generateOffsets()) {
    const leftNo = CONFIG.centerLeft + offset;
    const rightNo = leftNo + 1;

    if (leftNo < 1) continue;

    for (const row of CONFIG.rowPriority) {
      const left = seatLocator(page, row, leftNo);
      const right = seatLocator(page, row, rightNo);

      if (!(await seatAvailable(left))) continue;
      if (!(await seatAvailable(right))) continue;
      if (!(await seatsAreAdjacent(left, right))) {
        log(`건너뜀: ${row}${leftNo}-${row}${rightNo} (통로/비연속 가능성)`);
        continue;
      }

      return {
        row,
        leftNo,
        rightNo,
        left,
        right,
        names: [seatName(row, leftNo), seatName(row, rightNo)],
      };
    }
  }

  return null;
}

async function selectBestSeats(page) {
  log("좌석도 로딩 대기");

  await page
    .locator("button[data-seatlocno]")
    .first()
    .waitFor({
      state: "attached",
      timeout: CONFIG.domTimeoutMs,
    });

  await page.waitForTimeout(300);

  for (let attempt = 1; attempt <= 20; attempt++) {
    const pair = await findBestPair(page);

    if (!pair) {
      log(`연속 2자리 탐색 중... (${attempt}/20)`);
      await sleep(200);
      continue;
    }

    log(`🚨 좌석 후보: ${pair.names.join(" + ")}`);

    const leftLoc = await pair.left.getAttribute("data-seatlocno");
    const rightLoc = await pair.right.getAttribute("data-seatlocno");

    log(`${pair.names[0]} seatLocNo=${leftLoc}`);
    log(`${pair.names[1]} seatLocNo=${rightLoc}`);

    await pair.left.click();
    log(`✅ ${pair.names[0]} 클릭`);

    await page.waitForTimeout(150);

    // 첫 좌석 클릭 후 React 재렌더링에 대비해 두 번째 좌석 재조회
    const refreshedRight = seatLocator(page, pair.row, pair.rightNo);

    if (!(await seatAvailable(refreshedRight))) {
      log(`⚠️ ${pair.names[1]} 상태가 변경됨. 첫 좌석 취소 후 재탐색`);

      const refreshedLeft = seatLocator(page, pair.row, pair.leftNo);
      if ((await refreshedLeft.count()) > 0) {
        await refreshedLeft.click().catch(() => {});
      }

      await page.waitForTimeout(150);
      continue;
    }

    await refreshedRight.click();
    log(`✅ ${pair.names[1]} 클릭`);

    return pair;
  }

  throw new Error("J/I/L 중앙 주변에서 선택 가능한 연속 2자리를 찾지 못했습니다.");
}

/* ------------------------------------------------------------------ */
/* 선택완료                                                             */
/* ------------------------------------------------------------------ */

async function completeSeatSelection(page) {
  const complete = page.getByRole("button", {
    name: "선택완료",
    exact: true,
  });

  await complete.waitFor({
    state: "visible",
    timeout: CONFIG.domTimeoutMs,
  });

  if (!(await complete.isEnabled())) {
    throw new Error("[선택완료] 버튼이 비활성화 상태입니다.");
  }

  log("✅ [선택완료] 클릭");
  await complete.click();

  alarm();
  log("🎉 좌석 선택 완료");
  log("결제/최종 구매는 브라우저에서 직접 진행하세요.");
}

/* ------------------------------------------------------------------ */
/* MAIN                                                                */
/* ------------------------------------------------------------------ */

(async () => {
  const context = await chromium.launchPersistentContext(CONFIG.userDataDir, {
    headless: false,
    channel: "chrome",
    viewport: null,
    args: ["--start-maximized"],
  });

  const pages = context.pages();
  const page = pages[0] || (await context.newPage());

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.error("[브라우저]", msg.text());
    }
  });

  try {
    await gotoBookingPage(page);

    // 이미 로그인되어 있으면 가장 좋다.
    // 로그인 페이지라면 사용자가 직접 로그인한 뒤 원래 페이지로 돌아온다.
    if (page.url().includes("/mem/login")) {
      await waitForManualLoginIfNeeded(page);
      await gotoBookingPage(page);
    }

    const schedule = await waitForOpening(context);

    await gotoBookingPage(page);
    await enterRound(page, schedule);

    // 회차 클릭 후 인원 선택 UI까지 기다린다.
    // 일부 경우 같은 페이지에서 UI가 변경되고, 일부 경우 경로가 바뀔 수 있다.
    const peopleButton = page.locator('button[aria-label="2 선택"]');

    if ((await peopleButton.count()) === 0) {
      // 로그인 모달이 늦게 뜨는 경우 한 번 더 처리
      await clickLoginModalIfPresent(page);
      await page.waitForTimeout(500);

      if (page.url().includes("/mem/login")) {
        await waitForManualLoginIfNeeded(page);
        await gotoBookingPage(page);
        await enterRound(page, schedule);
      }
    }

    await selectTwoPeople(page);
    const pair = await selectBestSeats(page);

    log(`선택한 좌석: ${pair.names.join(", ")}`);

    await completeSeatSelection(page);
  } catch (err) {
    alarm();
    console.error("\n🛑 자동화 중단");
    console.error(err);
    console.error("\n브라우저는 닫지 않았습니다. 현재 화면을 확인하세요.");
  }

  // context.close()를 호출하지 않아 브라우저를 그대로 둔다.
})();
