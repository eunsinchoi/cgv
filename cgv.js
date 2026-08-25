const { chromium } = require("playwright");
const { execFile } = require("child_process");
const OPTIONS = require("./options");

const CONFIG = {
  bookingUrl:
    "https://cgv.co.kr/cnm/movieBook/movie",

  loginUrl:
    "https://cgv.co.kr/mem/login?returnUrl=%2Ftme%2FtmeShowMore",

  userDataDir:
    "./browser-data",

  // searchSchByMov 조회 주기
  // 페이지 새로고침이 아니라 fetch 조회만 반복
  scheduleIntervalMs:
    1000,

  coCd:
    "A420",

  // 스케줄 감지 후 단 한 번 reload한 뒤 렌더링 대기
  afterReloadWaitMs:
    250,

  timeSearchIntervalMs:
    150,

  domTimeoutMs:
    30000,

  loginTimeoutMs:
    10 * 60 * 1000,

  // 0 = 무제한 감시
  watchTimeoutMinutes:
    0,

  imaxParentDepth:
    12,

  imaxGroupMaxTimeButtons:
    12,
};


const sleep = (ms) =>
  new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        ms
      )
  );


function now() {
  return new Date()
    .toLocaleTimeString(
      "ko-KR"
    );
}


function log(...args) {
  console.log(
    `[CGV ${now()}]`,
    ...args
  );
}


function alarm(
  count = 1
) {
  for (
    let i = 0;
    i < count;
    i++
  ) {
    process.stdout.write(
      "\x07"
    );
  }
}


function runCommand(
  command,
  args
) {
  return new Promise(
    (resolve) => {
      execFile(
        command,
        args,
        (err) => {
          if (err) {
            console.error(
              "[창 활성화 오류]",
              err.message
            );
          }

          resolve();
        }
      );
    }
  );
}


function escapeRegExp(
  value
) {
  return String(
    value
  )
    .replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );
}


function exactTextRegex(
  value
) {
  return new RegExp(
    `^\\s*${escapeRegExp(value)}\\s*$`
  );
}


/* ================================================================
 * OPTIONS 검사
 * ================================================================ */

function validateOptions() {
  if (
    !OPTIONS.movie.movNo
  ) {
    throw new Error(
      "OPTIONS.movie.movNo를 설정해주세요."
    );
  }

  if (
    !OPTIONS.theater.siteNo
  ) {
    throw new Error(
      "OPTIONS.theater.siteNo를 설정해주세요."
    );
  }

  if (
    !Number.isInteger(
      OPTIONS.people
    ) ||
    OPTIONS.people < 1
  ) {
    throw new Error(
      "OPTIONS.people은 1 이상의 정수여야 합니다."
    );
  }

  if (
    !OPTIONS.time
      .preferredStarts
      ?.length
  ) {
    throw new Error(
      "OPTIONS.time.preferredStarts를 하나 이상 설정해주세요."
    );
  }

  if (
    !OPTIONS.seats
      .rowPriority
      ?.length
  ) {
    throw new Error(
      "OPTIONS.seats.rowPriority를 하나 이상 설정해주세요."
    );
  }

  if (
    OPTIONS.payment.method !==
    "toss"
  ) {
    throw new Error(
      "현재 결제수단 자동 선택은 toss만 지원합니다."
    );
  }
}


/* ================================================================
 * 정확한 텍스트의 button 찾기
 * ================================================================ */

async function findButtonByExactText(
  root,
  text
) {
  const exact =
    exactTextRegex(
      text
    );

  const spans =
    root
      .locator(
        "span"
      )
      .filter({
        hasText:
          exact,
      });

  const spanCount =
    await spans.count();

  for (
    let i = 0;
    i < spanCount;
    i++
  ) {
    const span =
      spans.nth(
        i
      );

    if (
      !(
        await span
          .isVisible()
          .catch(
            () => false
          )
      )
    ) {
      continue;
    }

    const button =
      span.locator(
        "xpath=ancestor::button[1]"
      );

    if (
      (
        await button.count()
      ) === 0
    ) {
      continue;
    }

    if (
      !(
        await button
          .isVisible()
          .catch(
            () => false
          )
      )
    ) {
      continue;
    }

    return button;
  }

  const buttons =
    root
      .locator(
        "button"
      )
      .filter({
        hasText:
          exact,
      });

  const buttonCount =
    await buttons.count();

  for (
    let i = 0;
    i < buttonCount;
    i++
  ) {
    const button =
      buttons.nth(
        i
      );

    if (
      !(
        await button
          .isVisible()
          .catch(
            () => false
          )
      )
    ) {
      continue;
    }

    return button;
  }

  return null;
}


async function findEnabledButtonByExactText(
  root,
  text
) {
  const button =
    await findButtonByExactText(
      root,
      text
    );

  if (
    !button
  ) {
    return null;
  }

  if (
    !(
      await button
        .isEnabled()
        .catch(
          () => false
        )
    )
  ) {
    return null;
  }

  if (
    (
      await button
        .getAttribute(
          "aria-disabled"
        )
    ) ===
    "true"
  ) {
    return null;
  }

  return button;
}


async function waitForEnabledExactTextButton(
  root,
  text,
  timeout =
    CONFIG.domTimeoutMs
) {
  const deadline =
    Date.now() +
    timeout;

  while (
    Date.now() <
    deadline
  ) {
    const button =
      await findEnabledButtonByExactText(
        root,
        text
      );

    if (
      button
    ) {
      return button;
    }

    await sleep(
      100
    );
  }

  throw new Error(
    `[${text}] 버튼을 찾지 못했거나 비활성화 상태입니다.`
  );
}


async function findVisibleEnabledButtonByRegex(
  root,
  regex
) {
  const buttons =
    root.locator(
      "button"
    );

  const count =
    await buttons.count();

  const candidates =
    [];

  for (
    let i = 0;
    i < count;
    i++
  ) {
    const button =
      buttons.nth(
        i
      );

    if (
      !(
        await button
          .isVisible()
          .catch(
            () => false
          )
      )
    ) {
      continue;
    }

    if (
      !(
        await button
          .isEnabled()
          .catch(
            () => false
          )
      )
    ) {
      continue;
    }

    if (
      (
        await button
          .getAttribute(
            "aria-disabled"
          )
      ) ===
      "true"
    ) {
      continue;
    }

    const text =
      (
        await button
          .textContent()
          .catch(
            () => ""
          )
      )
        .replace(
          /\s+/g,
          " "
        )
        .trim();

    regex.lastIndex =
      0;

    if (
      !regex.test(
        text
      )
    ) {
      continue;
    }

    const box =
      await button
        .boundingBox()
        .catch(
          () => null
        );

    candidates.push({
      button,
      text,

      y:
        box?.y ??
        -1,
    });
  }

  if (
    candidates.length ===
    0
  ) {
    return null;
  }

  candidates.sort(
    (
      a,
      b
    ) =>
      b.y -
      a.y
  );

  return candidates[
    0
  ].button;
}


/* ================================================================
 * CGV 창 앞으로
 * ================================================================ */

async function bringCgvWindowToFront(
  page
) {
  const marker =
    `CGV-AUTO-WINDOW-${process.pid}`;

  const oldTitle =
    await page
      .title()
      .catch(
        () => ""
      );

  await page.evaluate(
    (
      title
    ) => {
      document.title =
        title;
    },
    marker
  );

  await page
    .bringToFront()
    .catch(
      () => {}
    );

  await page.waitForTimeout(
    150
  );

  try {
    if (
      process.platform ===
      "darwin"
    ) {
      const script = `
tell application "Google Chrome"

  repeat with w in windows

    repeat with i from 1 to count of tabs of w

      if title of tab i of w contains "${marker}" then

        set active tab index of w to i
        set minimized of w to false
        set index of w to 1

        activate

        return

      end if

    end repeat

  end repeat

end tell
      `;

      await runCommand(
        "osascript",
        [
          "-e",
          script,
        ]
      );
    }

    else if (
      process.platform ===
      "win32"
    ) {
      const psScript = `
Add-Type -AssemblyName Microsoft.VisualBasic

$chrome = Get-Process chrome |
  Where-Object {
    $_.MainWindowTitle -like "*${marker}*"
  } |
  Select-Object -First 1

if ($chrome) {

  [Microsoft.VisualBasic.Interaction]::AppActivate(
    $chrome.Id
  )

}
      `;

      await runCommand(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          psScript,
        ]
      );
    }

    else {
      log(
        `현재 OS(${process.platform})에서는 page.bringToFront()만 사용합니다.`
      );
    }

  } finally {
    await page.evaluate(
      (
        title
      ) => {
        document.title =
          title;
      },
      oldTitle
    )
      .catch(
        () => {}
      );
  }
}


/* ================================================================
 * 로그인
 * ================================================================ */

async function loginFirst(
  page
) {
  log(
    "🔐 CGV 로그인 페이지를 엽니다."
  );

  log(
    "아이디 / 비밀번호 / CAPTCHA는 직접 입력하세요."
  );

  await page.goto(
    CONFIG.loginUrl,
    {
      waitUntil:
        "domcontentloaded",
    }
  );

  if (
    !page
      .url()
      .includes(
        "/mem/login"
      )
  ) {
    log(
      "✅ 이미 로그인된 세션입니다."
    );

    return;
  }

  alarm();

  const captcha =
    page.locator(
      'input[name="captcha"]'
    );

  if (
    (
      await captcha.count()
    ) > 0
  ) {
    await captcha
      .first()
      .focus()
      .catch(
        () => {}
      );
  }

  log(
    "⏸️ 로그인 완료를 기다립니다."
  );

  try {
    await page.waitForURL(
      (
        url
      ) =>
        !url.pathname.includes(
          "/mem/login"
        ),
      {
        timeout:
          CONFIG.loginTimeoutMs,
      }
    );

  } catch {
    throw new Error(
      `로그인이 ${CONFIG.loginTimeoutMs / 60000}분 안에 완료되지 않았습니다.`
    );
  }

  log(
    "✅ 로그인 완료"
  );

  await page.waitForTimeout(
    500
  );
}


async function clickLoginModalIfPresent(
  page
) {
  const dialogs =
    page.getByRole(
      "dialog"
    );

  const count =
    await dialogs.count();

  for (
    let i = 0;
    i < count;
    i++
  ) {
    const dialog =
      dialogs.nth(
        i
      );

    if (
      !(
        await dialog
          .isVisible()
          .catch(
            () => false
          )
      )
    ) {
      continue;
    }

    const text =
      (
        await dialog
          .textContent()
          .catch(
            () => ""
          )
      )
        .replace(
          /\s+/g,
          " "
        )
        .trim();

    if (
      !text.includes(
        "CGV 회원 로그인이 필요한 서비스"
      )
    ) {
      continue;
    }

    const confirm =
      await findEnabledButtonByExactText(
        dialog,
        "확인"
      );

    if (
      !confirm
    ) {
      return false;
    }

    log(
      "⚠️ 로그인 세션 만료 → [확인] 클릭"
    );

    await confirm.click();

    return true;
  }

  return false;
}


async function waitForManualLoginIfNeeded(
  page
) {
  if (
    !page
      .url()
      .includes(
        "/mem/login"
      )
  ) {
    return false;
  }

  alarm();

  log(
    "⚠️ 재로그인이 필요합니다. 브라우저에서 직접 로그인해주세요."
  );

  try {
    await page.waitForURL(
      (
        url
      ) =>
        !url.pathname.includes(
          "/mem/login"
        ),
      {
        timeout:
          CONFIG.loginTimeoutMs,
      }
    );

  } catch {
    throw new Error(
      "재로그인이 제한시간 내 완료되지 않았습니다."
    );
  }

  log(
    "✅ 재로그인 완료"
  );

  return true;
}


/* ================================================================
 * 예매 페이지
 * ================================================================ */

async function gotoBookingPage(
  page
) {
  const params =
    new URLSearchParams({
      movNo:
        OPTIONS.movie.movNo,

      siteNo:
        OPTIONS.theater.siteNo,
    });

  await page.goto(
    `${CONFIG.bookingUrl}?${params.toString()}`,
    {
      waitUntil:
        "domcontentloaded",
    }
  );

  await page.waitForTimeout(
    700
  );
}


/* ================================================================
 * 날짜 버튼 판별
 * ================================================================ */

async function isDateButtonForDay(
  button,
  day
) {
  return await button.evaluate(
    (
      el,
      targetDay
    ) => {
      const spans =
        [
          ...el.querySelectorAll(
            "span"
          ),
        ]
          .map(
            (
              span
            ) =>
              (
                span.textContent ||
                ""
              )
                .trim()
          )
          .filter(
            Boolean
          );

      const hasDayNumber =
        spans.includes(
          String(
            targetDay
          )
        );

      const hasWeekday =
        spans.some(
          (
            text
          ) =>
            /^[월화수목금토일]$/
              .test(
                text
              )
        );

      return (
        hasDayNumber &&
        hasWeekday
      );
    },
    day
  );
}


async function findDayButton(
  page,
  day,
  {
    requireEnabled =
      false,
  } = {}
) {
  const buttons =
    page.locator(
      "button"
    );

  const count =
    await buttons.count();

  for (
    let i = 0;
    i < count;
    i++
  ) {
    const button =
      buttons.nth(
        i
      );

    if (
      !(
        await button
          .isVisible()
          .catch(
            () => false
          )
      )
    ) {
      continue;
    }

    if (
      !(
        await isDateButtonForDay(
          button,
          day
        )
      )
    ) {
      continue;
    }

    if (
      requireEnabled
    ) {
      if (
        !(
          await button
            .isEnabled()
            .catch(
              () => false
            )
        )
      ) {
        continue;
      }

      if (
        (
          await button
            .getAttribute(
              "aria-disabled"
            )
        ) ===
        "true"
      ) {
        continue;
      }
    }

    return button;
  }

  return null;
}


/* ================================================================
 * watchDay를 실제 YYYYMMDD로 변환
 *
 * 예:
 * 현재 2026-08-24
 * watchDay = 31
 * → 20260831
 *
 * watchDay=31이 지난 뒤라면
 * 다음에 존재하는 31일을 사용
 * ================================================================ */

function resolveWatchScnYmd(
  watchDay
) {
  const today =
    new Date();

  const todayOnly =
    new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );

  for (
    let monthOffset = 0;
    monthOffset < 24;
    monthOffset++
  ) {
    const candidateMonth =
      new Date(
        today.getFullYear(),
        today.getMonth() + monthOffset,
        1
      );

    const year =
      candidateMonth.getFullYear();

    const month =
      candidateMonth.getMonth();

    const lastDay =
      new Date(
        year,
        month + 1,
        0
      )
        .getDate();

    if (
      watchDay < 1 ||
      watchDay > lastDay
    ) {
      continue;
    }

    const candidate =
      new Date(
        year,
        month,
        watchDay
      );

    if (
      candidate < todayOnly
    ) {
      continue;
    }

    const yyyy =
      String(
        year
      );

    const mm =
      String(
        month + 1
      )
        .padStart(
          2,
          "0"
        );

    const dd =
      String(
        watchDay
      )
        .padStart(
          2,
          "0"
        );

    return `${yyyy}${mm}${dd}`;
  }

  throw new Error(
    `watchDay=${watchDay}에 해당하는 조회 날짜를 계산하지 못했습니다.`
  );
}


/* ================================================================
 * searchSchByMov
 *
 * 중요:
 * - 날짜 버튼을 감시하는 것이 아님
 * - 해당 날짜 영화 스케줄이 서버에 생성되었는지 조회
 * - reload 없음
 * - searchRtktCntlYn 없음
 * ================================================================ */

async function searchSchedule(
  page,
  scnYmd
) {

  return await page.evaluate(
    async (
      config
    ) => {

      const params =
        new URLSearchParams({
          coCd:
            config.coCd,

          siteNo:
            config.siteNo,

          scnYmd:
            config.scnYmd,

          movNo:
            config.movNo,

          rtctlScopCd:
            "08",
        });


      const response =
        await fetch(
          `/api/v1/booking/searchSchByMov?${params.toString()}`,
          {
            method:
              "GET",

            credentials:
              "include",

            cache:
              "no-store",

            headers: {
              accept:
                "application/json",
            },
          }
        );


      if (
        !response.ok
      ) {

        throw new Error(
          `searchSchByMov HTTP ${response.status}`
        );
      }


      const result =
        await response.json();


      if (
        !Array.isArray(
          result.data
        ) ||
        result.data.length ===
          0
      ) {

        return null;
      }


      /*
       * 해당 날짜 / 영화 / 극장의
       * IMAX 스케줄만 추림
       */

      const imaxSchedules =
        result.data.filter(
          (
            item
          ) => {

            /*
             * 기본 조건
             */

            if (
              String(
                item.siteNo
              ) !==
                String(
                  config.siteNo
                )
            ) {

              return false;
            }


            if (
              String(
                item.movNo
              ) !==
                String(
                  config.movNo
                )
            ) {

              return false;
            }


            if (
              String(
                item.scnYmd
              ) !==
                String(
                  config.scnYmd
                )
            ) {

              return false;
            }


            /*
             * 용산 IMAX 상영관 번호
             *
             * 현재:
             * scnsNo = 018
             */

            if (
              config.scnsNo &&
              String(
                item.scnsNo
              ) ===
                String(
                  config.scnsNo
                )
            ) {

              return true;
            }


            /*
             * 상영관 번호가 변경되거나
             * 다른 극장을 사용할 경우를 위한 fallback
             */

            const texts =
              [
                item.scnsNm,
                item.expoScnsNm,
                item.tcscnsGradNm,
                item.movkndDsplNm,
                item.movkndDsplEnm,
                item.prodNm,
                item.expoProdNm,
              ]
                .filter(
                  Boolean
                )
                .map(
                  (
                    value
                  ) =>
                    String(
                      value
                    )
                      .toUpperCase()
                );


            return texts.some(
              (
                text
              ) =>
                text.includes(
                  "IMAX"
                ) ||
                text.includes(
                  "아이맥스"
                )
            );
          }
        );


      if (
        imaxSchedules.length ===
        0
      ) {

        /*
         * 일반관 스케줄이 있어도
         * IMAX가 없으면 아직 미감지
         */

        return null;
      }


      /*
       * IMAX 스케줄 중 가장 이른 회차를
       * 대표값으로 반환.
       *
       * 실제 20시/21시 선택은 이후
       * DOM 시간 선택 로직에서 수행.
       */

      imaxSchedules.sort(
        (
          a,
          b
        ) =>
          String(
            a.scnsrtTm ||
            ""
          )
            .localeCompare(
              String(
                b.scnsrtTm ||
                ""
              )
            )
      );


      return imaxSchedules[
        0
      ];
    },

    {
      coCd:
        CONFIG.coCd,

      siteNo:
        OPTIONS.theater.siteNo,

      movNo:
        OPTIONS.movie.movNo,

      scnYmd,

      scnsNo:
        OPTIONS.screen.scnsNo ||
        null,
    }
  );
}

/* ================================================================
 * watchDay 영화 편성 감시
 *
 * watchDay=31이면
 *
 * 31일 버튼이 생겼나? X
 *
 * searchSchByMov에서
 * 31일 해당 영화의 스케줄이 생겼나? O
 * ================================================================ */

async function waitForWatchSchedule(
  page,
  watchDay
) {
  const scnYmd =
    resolveWatchScnYmd(
      watchDay
    );

  const startedAt =
    Date.now();

  const timeoutMs =
    CONFIG.watchTimeoutMinutes > 0
      ?
        CONFIG.watchTimeoutMinutes *
        60 *
        1000
      :
        0;

  let lastStatusLogAt =
    0;

  log(
    `${watchDay}일 영화 스케줄 감시 시작 (${scnYmd})`
  );

  while (
    true
  ) {
    if (
      timeoutMs > 0 &&
      Date.now() -
        startedAt >=
        timeoutMs
    ) {
      throw new Error(
        `자동 감시 종료: ${CONFIG.watchTimeoutMinutes}분 동안 ${watchDay}일 영화 스케줄을 감지하지 못했습니다.`
      );
    }

    try {
      const schedule =
        await searchSchedule(
          page,
          scnYmd
        );

      if (
        schedule
      ) {
        return {
          schedule,
          scnYmd,
        };
      }

    } catch (
      err
    ) {
      if (
        String(
          err?.message ||
          ""
        )
          .startsWith(
            "자동 감시 종료:"
          )
      ) {
        throw err;
      }

      console.error(
        "[편성 조회 오류]",
        err.message
      );
    }

    if (
      Date.now() -
        lastStatusLogAt >=
      5000
    ) {
      const elapsed =
        (
          (
            Date.now() -
            startedAt
          ) /
          60000
        )
          .toFixed(
            1
          );

      log(
        `${watchDay}일 영화 스케줄 대기 중 | 경과 ${elapsed}분`
      );

      lastStatusLogAt =
        Date.now();
    }

    await sleep(
      CONFIG.scheduleIntervalMs
    );
  }
}


/* ================================================================
 * 날짜 DOM 버튼 대기
 *
 * 여기서는 절대 reload 하지 않음.
 * 스케줄 감지 후 이미 한 번 reload한 DOM만 확인.
 * ================================================================ */

async function waitForDayButton(
  page,
  day,
  {
    requireEnabled =
      false,

    description =
      `${day}일`,
  } = {}
) {

  let lastStatusLogAt =
    0;


  while (
    true
  ) {

    const button =
      await findDayButton(
        page,
        day,
        {
          requireEnabled,
        }
      );


    if (
      button
    ) {

      return button;
    }


    if (
      Date.now() -
        lastStatusLogAt >=
      5000
    ) {

      log(
        `${description} 버튼 DOM 대기 중`
      );


      lastStatusLogAt =
        Date.now();
    }


    await sleep(
      100
    );
  }
}


/* ================================================================
 * 영화 스케줄 감지
 * ↓
 * 창 앞으로
 * ↓
 * 딱 한 번 reload
 * ↓
 * targetDay 실제 버튼 클릭
 * ================================================================ */

async function waitForTargetDate(
  page
) {
  const {
    watchDay,
    targetDay,
  } =
    OPTIONS.date;

  /*
   * 여기서 watchDay는 날짜 DOM 버튼이 아니라
   * searchSchByMov의 영화 편성을 뜻함.
   */

  const {
    schedule,
    scnYmd,
  } =
    await waitForWatchSchedule(
      page,
      watchDay
    );

  alarm(
    2
  );

  log(
    `🚨 ${watchDay}일 영화 스케줄 감지 (${scnYmd}) → CGV 창 최전면 이동`
  );

  if (
    schedule?.scnsrtTm ||
    schedule?.scnendTm
  ) {
    log(
      `감지된 IMAX 스케줄: ${
        schedule.scnsNm ||
        schedule.expoScnsNm ||
        "IMAX"
      } / ${
        schedule.scnsrtTm ||
        "?"
      }~${
        schedule.scnendTm ||
        "?"
      } / ${
        schedule.movkndDsplNm ||
        schedule.prodNm ||
        schedule.movNm ||
        ""
      }`
    );
  }

  await bringCgvWindowToFront(
    page
  );

  /*
   * 감시 중에는 reload 하지 않고,
   * 편성 감지된 이 순간 단 한 번만 reload.
   */

  log(
    "영화 스케줄 감지 → 예매 페이지 1회 새로고침"
  );

  await page.reload({
    waitUntil:
      "domcontentloaded",

    timeout:
      CONFIG.domTimeoutMs,
  });

  await page.waitForTimeout(
    CONFIG.afterReloadWaitMs
  );

  /*
   * reload 후 실제 targetDay DOM 버튼 탐색
   */

  const targetButton =
    await waitForDayButton(
      page,
      targetDay,
      {
        requireEnabled:
          true,

        description:
          `${targetDay}일`,
      }
    );

  alarm();

  log(
    `🚨 ${targetDay}일 날짜 버튼 감지 → 실제 버튼 클릭`
  );

  await targetButton.click();

  await page.waitForTimeout(
    400
  );

  return schedule;
}


/* ================================================================
 * 재진입 시 targetDay 재선택
 * ================================================================ */

async function clickTargetDayIfPresent(
  page
) {
  const button =
    await findDayButton(
      page,
      OPTIONS.date.targetDay,
      {
        requireEnabled:
          true,
      }
    );

  if (
    !button
  ) {
    return false;
  }

  await button.click();

  await page.waitForTimeout(
    350
  );

  return true;
}


/* ================================================================
 * 선호 시간
 * ================================================================ */

function getTimePreferenceIndex(
  startText
) {
  for (
    let i = 0;
    i <
      OPTIONS.time
        .preferredStarts
        .length;
    i++
  ) {
    const pattern =
      String(
        OPTIONS.time
          .preferredStarts[
            i
          ]
      )
        .trim();

    if (
      /^\d{2}:\*$/
        .test(
          pattern
        )
    ) {
      const prefix =
        pattern.slice(
          0,
          3
        );

      if (
        startText.startsWith(
          prefix
        )
      ) {
        return i;
      }

      continue;
    }

    if (
      startText ===
      pattern
    ) {
      return i;
    }
  }

  return -1;
}


/* ================================================================
 * IMAX / NORMAL 판별
 * ================================================================ */

async function isImaxTimeButton(
  button
) {
  const targetType =
    String(
      OPTIONS.screen.type
    )
      .toUpperCase();

  const detectedImax =
    await button.evaluate(
      (
        el,
        options
      ) => {
        let parent =
          el.parentElement;

        for (
          let depth = 0;

          depth <
            options.maxDepth &&
          parent;

          depth++,
          parent =
            parent.parentElement
        ) {
          const normalizedText =
            (
              parent.textContent ||
              ""
            )
              .replace(
                /\s+/g,
                ""
              )
              .toUpperCase();

          const hasImax =
            normalizedText.includes(
              "IMAX"
            ) ||
            normalizedText.includes(
              "아이맥스"
            );

          if (
            !hasImax
          ) {
            continue;
          }

          const descendantButtons =
            [
              ...parent.querySelectorAll(
                "button"
              ),
            ];

          const timeButtonCount =
            descendantButtons.filter(
              (
                btn
              ) => {
                const spanTexts =
                  [
                    ...btn.querySelectorAll(
                      "span"
                    ),
                  ]
                    .map(
                      (
                        span
                      ) =>
                        (
                          span.textContent ||
                          ""
                        )
                          .trim()
                    );

                return spanTexts.some(
                  (
                    text
                  ) =>
                    /^\d{1,2}:\d{2}$/
                      .test(
                        text
                      )
                );
              }
            )
              .length;

          if (
            timeButtonCount >
              0 &&
            timeButtonCount <=
              options.maxTimeButtons
          ) {
            return true;
          }
        }

        return false;
      },

      {
        maxDepth:
          CONFIG.imaxParentDepth,

        maxTimeButtons:
          CONFIG.imaxGroupMaxTimeButtons,
      }
    );

  if (
    targetType ===
    "IMAX"
  ) {
    return detectedImax;
  }

  if (
    targetType ===
    "NORMAL"
  ) {
    return !detectedImax;
  }

  throw new Error(
    `지원하지 않는 상영관 타입입니다: ${OPTIONS.screen.type}`
  );
}


/* ================================================================
 * 선호 상영시간 탐색
 * ================================================================ */

async function findPreferredImaxTimeButton(
  page
) {
  const spans =
    page.locator(
      "span"
    );

  const count =
    await spans.count();

  const candidates =
    [];

  for (
    let i = 0;
    i < count;
    i++
  ) {
    const span =
      spans.nth(
        i
      );

    if (
      !(
        await span
          .isVisible()
          .catch(
            () => false
          )
      )
    ) {
      continue;
    }

    const startText =
      (
        await span
          .textContent()
          .catch(
            () => ""
          )
      )
        .trim();

    if (
      !/^\d{1,2}:\d{2}$/
        .test(
          startText
        )
    ) {
      continue;
    }

    const preferenceIndex =
      getTimePreferenceIndex(
        startText
      );

    if (
      preferenceIndex <
      0
    ) {
      continue;
    }

    const button =
      span.locator(
        "xpath=ancestor::button[1]"
      );

    if (
      (
        await button.count()
      ) === 0
    ) {
      continue;
    }

    if (
      !(
        await button
          .isVisible()
          .catch(
            () => false
          )
      )
    ) {
      continue;
    }

    if (
      !(
        await button
          .isEnabled()
          .catch(
            () => false
          )
      )
    ) {
      continue;
    }

    if (
      (
        await button
          .getAttribute(
            "aria-disabled"
          )
      ) ===
      "true"
    ) {
      continue;
    }

    /*
     * 버튼 내부에 시작/종료 시간이 모두 존재하므로
     * 첫 번째 시간만 시작 시간으로 인정.
     */

    const timeTexts =
      await button
        .locator(
          "span"
        )
        .evaluateAll(
          (
            nodes
          ) =>
            nodes
              .map(
                (
                  node
                ) =>
                  (
                    node.textContent ||
                    ""
                  )
                    .trim()
              )
              .filter(
                (
                  text
                ) =>
                  /^\d{1,2}:\d{2}$/
                    .test(
                      text
                    )
              )
        );

    if (
      timeTexts.length ===
        0 ||
      timeTexts[
        0
      ] !==
        startText
    ) {
      continue;
    }

    if (
      !(
        await isImaxTimeButton(
          button
        )
      )
    ) {
      continue;
    }

    candidates.push({
      button,
      startText,
      preferenceIndex,
    });
  }

  if (
    candidates.length ===
    0
  ) {
    return null;
  }

  candidates.sort(
    (
      a,
      b
    ) => {
      if (
        a.preferenceIndex !==
        b.preferenceIndex
      ) {
        return (
          a.preferenceIndex -
          b.preferenceIndex
        );
      }

      return a
        .startText
        .localeCompare(
          b.startText
        );
    }
  );

  return candidates[
    0
  ];
}


/* ================================================================
 * 상영시간 진입
 * ================================================================ */

async function enterPreferredImaxTime(
  page,
  {
    targetDayAlreadySelected =
      false,
  } = {}
) {
  const description =
    OPTIONS.time
      .preferredStarts
      .join(
        " / "
      );

  for (
    let attempt = 1;
    attempt <= 3;
    attempt++
  ) {
    log(
      `IMAX ${description} 회차 탐색 (${attempt}/3)`
    );

    const skipDateClick =
      attempt === 1 &&
      targetDayAlreadySelected;

    if (
      !skipDateClick
    ) {
      const dateReady =
        await clickTargetDayIfPresent(
          page
        );

      if (
        !dateReady
      ) {
        const targetButton =
          await waitForDayButton(
            page,
            OPTIONS.date.targetDay,
            {
              requireEnabled:
                true,

              description:
                `${OPTIONS.date.targetDay}일 재진입`,
            }
          );

        await targetButton.click();

        await page.waitForTimeout(
          350
        );
      }
    }

    const deadline =
      Date.now() +
      CONFIG.domTimeoutMs;

    let target =
      null;

    while (
      Date.now() <
        deadline &&
      !target
    ) {
      target =
        await findPreferredImaxTimeButton(
          page
        );

      if (
        !target
      ) {
        await sleep(
          CONFIG.timeSearchIntervalMs
        );
      }
    }

    if (
      !target
    ) {
      if (
        attempt <
        3
      ) {
        log(
          "조건에 맞는 IMAX 회차 없음 → 예매 페이지 재진입"
        );

        await gotoBookingPage(
          page
        );

        continue;
      }

      throw new Error(
        `${OPTIONS.date.targetDay}일에서 IMAX ${description} 회차를 찾지 못했습니다. 일반관은 선택하지 않습니다.`
      );
    }

    log(
      `✅ IMAX ${target.startText} → 시간 버튼 클릭`
    );

    await target
      .button
      .click();

    await page.waitForTimeout(
      400
    );

    await clickLoginModalIfPresent(
      page
    );

    await page.waitForTimeout(
      500
    );

    const didLogin =
      await waitForManualLoginIfNeeded(
        page
      );

    if (
      didLogin
    ) {
      await gotoBookingPage(
        page
      );

      continue;
    }

    return target;
  }

  throw new Error(
    "IMAX 회차 진입에 실패했습니다."
  );
}


/* ================================================================
 * 관람인원
 * ================================================================ */

async function findPeopleButton(
  page,
  people
) {
  const buttons =
    page.locator(
      "button"
    );

  const count =
    await buttons.count();

  for (
    let i = 0;
    i < count;
    i++
  ) {
    const button =
      buttons.nth(
        i
      );

    if (
      !(
        await button
          .isVisible()
          .catch(
            () => false
          )
      )
    ) {
      continue;
    }

    if (
      !(
        await button
          .isEnabled()
          .catch(
            () => false
          )
      )
    ) {
      continue;
    }

    const buttonText =
      (
        await button
          .textContent()
          .catch(
            () => ""
          )
      )
        .replace(
          /\s+/g,
          ""
        )
        .trim();

    const ariaLabel =
      (
        await button
          .getAttribute(
            "aria-label"
          )
      ) ||
      "";

    const numberMatches =
      buttonText ===
        String(
          people
        ) ||
      ariaLabel ===
        `${people} 선택`;

    if (
      !numberMatches
    ) {
      continue;
    }

    const inPeopleArea =
      await button.evaluate(
        (
          el
        ) => {
          let parent =
            el.parentElement;

          for (
            let depth = 0;
            depth < 8 &&
            parent;
            depth++
          ) {
            const text =
              (
                parent.textContent ||
                ""
              )
                .replace(
                  /\s+/g,
                  ""
                )
                .trim();

            if (
              text.includes(
                "관람인원"
              ) &&
              text.includes(
                "일반"
              )
            ) {
              return true;
            }

            parent =
              parent.parentElement;
          }

          return false;
        }
      );

    if (
      inPeopleArea
    ) {
      return button;
    }
  }

  return null;
}


async function findSeatEntryButton(
  page
) {
  const buttons =
    page.locator(
      "button"
    );

  const count =
    await buttons.count();

  for (
    let i = 0;
    i < count;
    i++
  ) {
    const button =
      buttons.nth(
        i
      );

    if (
      !(
        await button
          .isVisible()
          .catch(
            () => false
          )
      )
    ) {
      continue;
    }

    if (
      !(
        await button
          .isEnabled()
          .catch(
            () => false
          )
      )
    ) {
      continue;
    }

    const text =
      (
        await button
          .textContent()
          .catch(
            () => ""
          )
      )
        .trim();

    if (
      text !==
      "선택"
    ) {
      continue;
    }

    const correctArea =
      await button.evaluate(
        (
          el
        ) => {
          let parent =
            el.parentElement;

          for (
            let depth = 0;
            depth < 7 &&
            parent;
            depth++
          ) {
            const text =
              (
                parent.textContent ||
                ""
              )
                .replace(
                  /\s+/g,
                  " "
                )
                .trim();

            if (
              text.includes(
                "좌석을 선택해 주세요"
              )
            ) {
              return true;
            }

            parent =
              parent.parentElement;
          }

          return false;
        }
      );

    if (
      correctArea
    ) {
      return button;
    }
  }

  return await findEnabledButtonByExactText(
    page,
    "선택"
  );
}


async function selectPeopleAndOpenSeatMap(
  page
) {
  const people =
    OPTIONS.people;

  log(
    `관람인원 일반 ${people}명 버튼 대기`
  );

  const deadline =
    Date.now() +
    CONFIG.domTimeoutMs;

  let peopleButton =
    null;

  while (
    Date.now() <
      deadline &&
    !peopleButton
  ) {
    peopleButton =
      await findPeopleButton(
        page,
        people
      );

    if (
      !peopleButton
    ) {
      await sleep(
        100
      );
    }
  }

  if (
    !peopleButton
  ) {
    throw new Error(
      `일반 ${people}명 관람인원 버튼을 찾지 못했습니다.`
    );
  }

  await peopleButton.click();

  log(
    `✅ 일반 ${people}명 클릭`
  );

  const selectDeadline =
    Date.now() +
    CONFIG.domTimeoutMs;

  let selectButton =
    null;

  while (
    Date.now() <
      selectDeadline &&
    !selectButton
  ) {
    selectButton =
      await findSeatEntryButton(
        page
      );

    if (
      !selectButton
    ) {
      await sleep(
        100
      );
    }
  }

  if (
    !selectButton
  ) {
    throw new Error(
      "좌석 영역의 [선택] 버튼을 찾지 못했습니다."
    );
  }

  await selectButton.click();

  log(
    "✅ 하단 [선택] 클릭 → 좌석 선택 화면 진입"
  );
}


/* ================================================================
 * 좌석
 * ================================================================ */

function generateOffsets() {
  const offsets =
    [
      0,
    ];

  for (
    let d = 1;
    d <=
      OPTIONS.seats
        .maxDistance;
    d++
  ) {
    offsets.push(
      -d
    );

    offsets.push(
      d
    );
  }

  return offsets;
}


function seatName(
  row,
  number
) {
  return `${row}${number}`;
}


function seatButtonByName(
  page,
  row,
  number
) {
  const name =
    seatName(
      row,
      number
    );

  const exact =
    exactTextRegex(
      name
    );

  return page
    .locator(
      "span"
    )
    .filter({
      hasText:
        exact,
    })
    .locator(
      "xpath=ancestor::button[1]"
    )
    .first();
}


async function seatAvailable(
  locator
) {
  if (
    (
      await locator.count()
    ) ===
    0
  ) {
    return false;
  }

  if (
    !(
      await locator
        .isVisible()
        .catch(
          () => false
        )
    )
  ) {
    return false;
  }

  if (
    !(
      await locator
        .isEnabled()
        .catch(
          () => false
        )
    )
  ) {
    return false;
  }

  if (
    (
      await locator
        .getAttribute(
          "disabled"
        )
    ) !==
    null
  ) {
    return false;
  }

  if (
    (
      await locator
        .getAttribute(
          "aria-disabled"
        )
    ) ===
    "true"
  ) {
    return false;
  }

  const title =
    (
      (
        await locator
          .getAttribute(
            "title"
          )
      ) ||
      ""
    )
      .trim();

  if (
    title.includes(
      "선택됨"
    )
  ) {
    return false;
  }

  return true;
}


async function seatsAreAdjacent(
  left,
  right
) {
  const a =
    await left.boundingBox();

  const b =
    await right.boundingBox();

  if (
    !a ||
    !b
  ) {
    return false;
  }

  const sameRow =
    Math.abs(
      a.y -
      b.y
    ) <=
    5;

  const xDistance =
    Math.abs(
      b.x -
      a.x
    );

  const maxDistance =
    Math.max(
      a.width,
      b.width
    ) *
    1.65;

  return (
    sameRow &&
    xDistance <=
      maxDistance
  );
}


async function seatGroupIsAdjacent(
  locators
) {
  for (
    let i = 0;
    i <
      locators.length -
      1;
    i++
  ) {
    const adjacent =
      await seatsAreAdjacent(
        locators[
          i
        ],
        locators[
          i + 1
        ]
      );

    if (
      !adjacent
    ) {
      return false;
    }
  }

  return true;
}


/* ================================================================
 * 사용자가 직접 선택한 좌석 감지
 * ================================================================ */

async function getManualSelectedSeats(
  page
) {
  if (
    !OPTIONS.seats.allowManualOverride
  ) {
    return null;
  }

  const selectedNames =
    await page.evaluate(
      () => {
        const buttons =
          [
            ...document.querySelectorAll(
              "button"
            ),
          ];

        const result =
          [];

        for (
          const button of buttons
        ) {
          const title =
            (
              button.getAttribute(
                "title"
              ) ||
              ""
            )
              .trim();

          if (
            !title.includes(
              "선택됨"
            )
          ) {
            continue;
          }

          const spans =
            [
              ...button.querySelectorAll(
                "span"
              ),
            ];

          for (
            const span of spans
          ) {
            const text =
              (
                span.textContent ||
                ""
              )
                .trim();

            if (
              /^[A-Za-z]+\d+$/
                .test(
                  text
                )
            ) {
              result.push(
                text
              );

              break;
            }
          }
        }

        return [
          ...new Set(
            result
          ),
        ];
      }
    );

  if (
    selectedNames.length <
    OPTIONS.people
  ) {
    return null;
  }

  return {
    manual:
      true,

    count:
      OPTIONS.people,

    names:
      selectedNames.slice(
        0,
        OPTIONS.people
      ),
  };
}


async function findBestSeatGroup(
  page
) {
  const people =
    OPTIONS.people;

  const initialManual =
    await getManualSelectedSeats(
      page
    );

  if (
    initialManual
  ) {
    return initialManual;
  }

  for (
    const offset of
    generateOffsets()
  ) {
    const startNumber =
      OPTIONS.seats
        .centerStartNumber +
      offset;

    if (
      startNumber <
      1
    ) {
      continue;
    }

    for (
      const row of
      OPTIONS.seats
        .rowPriority
    ) {
      const manual =
        await getManualSelectedSeats(
          page
        );

      if (
        manual
      ) {
        return manual;
      }

      const locators =
        [];

      const names =
        [];

      let available =
        true;

      for (
        let i = 0;
        i < people;
        i++
      ) {
        const manualDuringSearch =
          await getManualSelectedSeats(
            page
          );

        if (
          manualDuringSearch
        ) {
          return manualDuringSearch;
        }

        const number =
          startNumber +
          i;

        const locator =
          seatButtonByName(
            page,
            row,
            number
          );

        if (
          !(
            await seatAvailable(
              locator
            )
          )
        ) {
          available =
            false;

          break;
        }

        locators.push(
          locator
        );

        names.push(
          seatName(
            row,
            number
          )
        );
      }

      if (
        !available
      ) {
        continue;
      }

      if (
        !(
          await seatGroupIsAdjacent(
            locators
          )
        )
      ) {
        log(
          `건너뜀: ${names.join(" + ")} (통로/비연속 가능성)`
        );

        continue;
      }

      return {
        manual:
          false,

        row,

        startNumber,

        count:
          people,

        names,
      };
    }
  }

  return null;
}


async function rollbackSelectedSeats(
  page,
  selectedNames
) {
  for (
    let i =
      selectedNames.length -
      1;

    i >= 0;

    i--
  ) {
    const match =
      /^([A-Za-z]+)(\d+)$/
        .exec(
          selectedNames[
            i
          ]
        );

    if (
      !match
    ) {
      continue;
    }

    const row =
      match[
        1
      ];

    const number =
      Number(
        match[
          2
        ]
      );

    const locator =
      seatButtonByName(
        page,
        row,
        number
      );

    if (
      (
        await locator.count()
      ) ===
      0
    ) {
      continue;
    }

    if (
      !(
        await locator
          .isVisible()
          .catch(
            () => false
          )
      )
    ) {
      continue;
    }

    if (
      !(
        await locator
          .isEnabled()
          .catch(
            () => false
          )
      )
    ) {
      continue;
    }

    await locator
      .click()
      .catch(
        () => {}
      );

    await page.waitForTimeout(
      80
    );
  }
}


async function waitForAnySeatButton(
  page
) {
  const deadline =
    Date.now() +
    CONFIG.domTimeoutMs;

  while (
    Date.now() <
    deadline
  ) {
    const spans =
      page.locator(
        "span"
      );

    const count =
      await spans.count();

    for (
      let i = 0;
      i < count;
      i++
    ) {
      const span =
        spans.nth(
          i
        );

      if (
        !(
          await span
            .isVisible()
            .catch(
              () => false
            )
        )
      ) {
        continue;
      }

      const text =
        (
          await span
            .textContent()
            .catch(
              () => ""
            )
        )
          .trim();

      if (
        !/^[A-Za-z]+\d+$/
          .test(
            text
          )
      ) {
        continue;
      }

      const button =
        span.locator(
          "xpath=ancestor::button[1]"
        );

      if (
        (
          await button.count()
        ) > 0
      ) {
        return;
      }
    }

    await sleep(
      100
    );
  }

  throw new Error(
    "좌석 버튼이 제한시간 내 로딩되지 않았습니다."
  );
}


async function selectBestSeats(
  page
) {
  log(
    "좌석도 로딩 대기"
  );

  await waitForAnySeatButton(
    page
  );

  await page.waitForTimeout(
    300
  );

  for (
    let attempt = 1;
    attempt <= 20;
    attempt++
  ) {
    const group =
      await findBestSeatGroup(
        page
      );

    if (
      !group
    ) {
      log(
        `연속 ${OPTIONS.people}자리 탐색 중... (${attempt}/20)`
      );

      await sleep(
        200
      );

      continue;
    }

    if (
      group.manual
    ) {
      log(
        `🙋 수동 좌석 선택 감지: ${group.names.join(" + ")}`
      );

      log(
        "✅ 자동 좌석 탐색 중단 → [선택완료] 단계로 이동"
      );

      return group;
    }

    log(
      `🚨 자동 좌석 후보: ${group.names.join(" + ")}`
    );

    const selectedNames =
      [];

    let failed =
      false;

    for (
      let i = 0;
      i < group.count;
      i++
    ) {
      const number =
        group.startNumber +
        i;

      const name =
        seatName(
          group.row,
          number
        );

      const locator =
        seatButtonByName(
          page,
          group.row,
          number
        );

      if (
        !(
          await seatAvailable(
            locator
          )
        )
      ) {
        log(
          `⚠️ ${name} 상태 변경 → 기존 선택 취소 후 재탐색`
        );

        failed =
          true;

        break;
      }

      await locator.click();

      selectedNames.push(
        name
      );

      log(
        `✅ ${name} 좌석 클릭`
      );

      await page.waitForTimeout(
        150
      );
    }

    if (
      failed
    ) {
      await rollbackSelectedSeats(
        page,
        selectedNames
      );

      await page.waitForTimeout(
        150
      );

      continue;
    }

    log(
      `✅ 연속 ${OPTIONS.people}좌석 선택 성공`
    );

    return group;
  }

  throw new Error(
    `설정된 좌석 우선순위에서 선택 가능한 연속 ${OPTIONS.people}자리를 찾지 못했습니다.`
  );
}


/* ================================================================
 * 선택완료
 * ================================================================ */

async function completeSeatSelection(
  page
) {
  const completeButton =
    await waitForEnabledExactTextButton(
      page,
      "선택완료"
    );

  log(
    "✅ [선택완료] 클릭"
  );

  await completeButton.click();

  await page.waitForTimeout(
    300
  );
}


/* ================================================================
 * 결제 전 확인
 * ================================================================ */

async function clickPrePaymentConfirm(
  page
) {
  log(
    "결제 전 확인 모달 대기"
  );

  const deadline =
    Date.now() +
    CONFIG.domTimeoutMs;

  while (
    Date.now() <
    deadline
  ) {
    const dialogs =
      page.getByRole(
        "dialog"
      );

    const count =
      await dialogs.count();

    for (
      let i = 0;
      i < count;
      i++
    ) {
      const dialog =
        dialogs.nth(
          i
        );

      if (
        !(
          await dialog
            .isVisible()
            .catch(
              () => false
            )
        )
      ) {
        continue;
      }

      const dialogText =
        (
          await dialog
            .textContent()
            .catch(
              () => ""
            )
        )
          .replace(
            /\s+/g,
            " "
          )
          .trim();

      if (
        !dialogText.includes(
          "결제 전 확인해 주세요"
        )
      ) {
        continue;
      }

      const payButton =
        await findEnabledButtonByExactText(
          dialog,
          "결제하기"
        );

      if (
        !payButton
      ) {
        continue;
      }

      log(
        "✅ 결제 전 확인 모달 [결제하기] 클릭"
      );

      await payButton.click();

      await page.waitForTimeout(
        500
      );

      return;
    }

    await sleep(
      100
    );
  }

  throw new Error(
    "[결제 전 확인해 주세요] 모달의 [결제하기] 버튼을 찾지 못했습니다."
  );
}


/* ================================================================
 * TOSS
 * ================================================================ */

async function selectTossPayment(
  page
) {
  log(
    "TOSS 결제수단 대기"
  );

  const deadline =
    Date.now() +
    CONFIG.domTimeoutMs;

  while (
    Date.now() <
    deadline
  ) {
    const images =
      page.locator(
        "img"
      );

    const count =
      await images.count();

    for (
      let i = 0;
      i < count;
      i++
    ) {
      const image =
        images.nth(
          i
        );

      if (
        !(
          await image
            .isVisible()
            .catch(
              () => false
            )
        )
      ) {
        continue;
      }

      const alt =
        (
          (
            await image
              .getAttribute(
                "alt"
              )
          ) ||
          ""
        )
          .trim()
          .toLowerCase();

      if (
        alt !==
        "toss"
      ) {
        continue;
      }

      const button =
        image.locator(
          "xpath=ancestor::button[1]"
        );

      if (
        (
          await button.count()
        ) ===
        0
      ) {
        continue;
      }

      if (
        !(
          await button
            .isVisible()
            .catch(
              () => false
            )
        )
      ) {
        continue;
      }

      if (
        !(
          await button
            .isEnabled()
            .catch(
              () => false
            )
        )
      ) {
        continue;
      }

      log(
        "✅ TOSS 결제수단 클릭"
      );

      await button.click();

      await page.waitForTimeout(
        300
      );

      return;
    }

    await sleep(
      100
    );
  }

  throw new Error(
    "TOSS 결제수단 버튼을 찾지 못했습니다."
  );
}


/* ================================================================
 * 전체 약관
 * ================================================================ */

async function agreeAllTerms(
  page
) {
  log(
    "전체 약관 동의 상태 확인"
  );

  const deadline =
    Date.now() +
    CONFIG.domTimeoutMs;

  while (
    Date.now() <
    deadline
  ) {
    const labels =
      page.locator(
        "label"
      );

    const count =
      await labels.count();

    for (
      let i = 0;
      i < count;
      i++
    ) {
      const label =
        labels.nth(
          i
        );

      if (
        !(
          await label
            .isVisible()
            .catch(
              () => false
            )
        )
      ) {
        continue;
      }

      const text =
        (
          await label
            .textContent()
            .catch(
              () => ""
            )
        )
          .replace(
            /\s+/g,
            " "
          )
          .trim();

      if (
        text !==
        "전체 약관 동의하기"
      ) {
        continue;
      }

      const forId =
        await label
          .getAttribute(
            "for"
          );

      let checkbox =
        null;

      if (
        forId
      ) {
        checkbox =
          page
            .locator(
              `input#${forId}`
            )
            .first();
      }

      if (
        !checkbox ||
        (
          await checkbox.count()
        ) ===
          0
      ) {
        checkbox =
          label
            .locator(
              "xpath=preceding::input[@type='checkbox'][1]"
            )
            .first();
      }

      if (
        (
          await checkbox.count()
        ) ===
        0
      ) {
        continue;
      }

      const checked =
        await checkbox
          .isChecked()
          .catch(
            () => false
          );

      if (
        checked
      ) {
        log(
          "✅ 전체 약관이 이미 동의된 상태입니다."
        );

        return;
      }

      await label.click();

      await page.waitForTimeout(
        200
      );

      const checkedAfter =
        await checkbox
          .isChecked()
          .catch(
            () => false
          );

      if (
        !checkedAfter
      ) {
        await checkbox
          .check()
          .catch(
            () => {}
          );
      }

      if (
        !(
          await checkbox
            .isChecked()
            .catch(
              () => false
            )
        )
      ) {
        throw new Error(
          "전체 약관 동의 체크에 실패했습니다."
        );
      }

      log(
        "✅ 전체 약관 동의하기 클릭"
      );

      return;
    }

    await sleep(
      100
    );
  }

  throw new Error(
    "[전체 약관 동의하기] 항목을 찾지 못했습니다."
  );
}


/* ================================================================
 * 최종 결제
 * ================================================================ */

async function clickFinalPayment(
  page
) {
  const finalPayRegex =
    /^\s*[\d,]+원\s*결제하기\s*$/;

  const deadline =
    Date.now() +
    CONFIG.domTimeoutMs;

  log(
    "최종 결제 버튼 대기"
  );

  while (
    Date.now() <
    deadline
  ) {
    const button =
      await findVisibleEnabledButtonByRegex(
        page,
        finalPayRegex
      );

    if (
      button
    ) {
      const text =
        (
          await button
            .textContent()
            .catch(
              () => ""
            )
        )
          .replace(
            /\s+/g,
            " "
          )
          .trim();

      if (
        !OPTIONS.payment
          .autoClickFinalPay
      ) {
        log(
          `⏸️ 최종 결제 버튼까지 준비됨: [${text}]`
        );

        log(
          "OPTIONS.payment.autoClickFinalPay=false라 클릭하지 않습니다."
        );

        return false;
      }

      log(
        `✅ 최종 [${text}] 클릭`
      );

      await button.click();

      return true;
    }

    await sleep(
      100
    );
  }

  throw new Error(
    "최종 [금액원 결제하기] 버튼을 찾지 못했습니다."
  );
}


async function proceedPayment(
  page
) {
  await clickPrePaymentConfirm(
    page
  );

  await page.waitForTimeout(
    700
  );

  await selectTossPayment(
    page
  );

  await agreeAllTerms(
    page
  );

  const clicked =
    await clickFinalPayment(
      page
    );

  if (
    clicked
  ) {
    alarm();

    log(
      "🎉 CGV 최종 결제하기 버튼까지 클릭했습니다."
    );

    log(
      "이후 TOSS 인증/앱 승인/비밀번호 등은 직접 진행하세요."
    );
  }
}


/* ================================================================
 * MAIN
 * ================================================================ */

(async () => {
  validateOptions();

  log(
    "========================================"
  );

  log(
    `영화: ${OPTIONS.movie.name} (${OPTIONS.movie.movNo})`
  );

  log(
    `극장: ${OPTIONS.theater.name} (${OPTIONS.theater.siteNo})`
  );

  log(
    `날짜: ${OPTIONS.date.watchDay}일 영화 스케줄 감지 → ${OPTIONS.date.targetDay}일 선택`
  );

  log(
    `시간: ${OPTIONS.screen.type} / ${OPTIONS.time.preferredStarts.join(" → ")}`
  );

  log(
    `관람인원: 일반 ${OPTIONS.people}명`
  );

  log(
    `좌석 행: ${OPTIONS.seats.rowPriority.join(" → ")}`
  );

  log(
    `좌석 중심 시작번호: ${OPTIONS.seats.centerStartNumber}`
  );

  log(
    "결제수단: TOSS"
  );

  log(
    `최종 결제 자동 클릭: ${
      OPTIONS.payment.autoClickFinalPay
        ?
          "ON"
        :
          "OFF"
    }`
  );

  log(
    "========================================"
  );

  const context =
    await chromium
      .launchPersistentContext(
        CONFIG.userDataDir,
        {
          headless:
            false,

          channel:
            "chrome",

          viewport:
            null,

          args: [
            "--start-maximized",
          ],
        }
      );

  const pages =
    context.pages();

  const page =
    pages[
      0
    ] ||
    (
      await context
        .newPage()
    );

  page.on(
    "console",
    (
      msg
    ) => {
      if (
        msg.type() ===
        "error"
      ) {
        console.error(
          "[브라우저]",
          msg.text()
        );
      }
    }
  );

  try {
    /*
     * 0. 로그인
     */

    await loginFirst(
      page
    );


    /*
     * 1. 예매 페이지 진입
     */

    await gotoBookingPage(
      page
    );


    /*
     * 2.
     *
     * searchSchByMov로 watchDay 영화 스케줄 감시
     *
     * 감시 중 reload 없음
     * ↓
     * 영화 편성 감지
     * ↓
     * 창 최전면
     * ↓
     * 딱 한 번 reload
     * ↓
     * targetDay 실제 날짜 버튼 클릭
     */

    await waitForTargetDate(
      page
    );


    /*
     * 3. 선호 상영시간
     */

    const selectedTime =
      await enterPreferredImaxTime(
        page,
        {
          targetDayAlreadySelected:
            true,
        }
      );

    log(
      `선택한 시작 시간: ${selectedTime.startText}`
    );


    /*
     * 로그인 모달이 늦게 나타나는 경우
     */

    await clickLoginModalIfPresent(
      page
    );

    await page.waitForTimeout(
      300
    );

    if (
      page
        .url()
        .includes(
          "/mem/login"
        )
    ) {
      await waitForManualLoginIfNeeded(
        page
      );

      await gotoBookingPage(
        page
      );

      await enterPreferredImaxTime(
        page
      );
    }


    /*
     * 4. 인원 → 좌석 화면
     */

    await selectPeopleAndOpenSeatMap(
      page
    );


    /*
     * 5. 좌석 선택
     */

    const seatGroup =
      await selectBestSeats(
        page
      );

    log(
      `선택한 좌석: ${seatGroup.names.join(", ")}`
    );


    /*
     * 6. 선택완료
     *
     * 자동 좌석 선택이면 자동 클릭.
     * 수동 좌석 선택이면 직접 클릭.
     */

    if (
      seatGroup.manual
    ) {
      log(
        "🙋 수동 좌석 선택 모드"
      );

      log(
        "⏸️ [선택완료] 버튼은 직접 클릭해주세요."
      );

      log(
        "결제 전 확인 모달이 나타나면 자동화를 다시 진행합니다."
      );

    } else {
      await completeSeatSelection(
        page
      );
    }


    /*
     * 7. 결제
     */

    await proceedPayment(
      page
    );

  } catch (
    err
  ) {
    alarm();

    console.error(
      "\n🛑 자동화 중단"
    );

    console.error(
      err
    );

    if (
      String(
        err?.message ||
        ""
      )
        .startsWith(
          "자동 감시 종료:"
        )
    ) {
      console.error(
        "\n⏱️ 설정한 감시 시간이 지나 자동으로 감시를 종료했습니다."
      );
    }

    console.error(
      "\n브라우저는 닫지 않았습니다. 현재 화면을 확인하세요."
    );
  }

  /*
   * context.close() 하지 않음
   * 브라우저는 그대로 유지
   */
})();