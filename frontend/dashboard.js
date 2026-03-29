(function () {
  "use strict";

  // ── 1. Constants & Config ───────────────────────────────

  var KP_SEVERITY = [
    { min: 0, max: 2.9, label: "Quiet", cssVar: "--kp-quiet" },
    { min: 3, max: 3.9, label: "Unsettled", cssVar: "--kp-unsettled" },
    { min: 4, max: 4.9, label: "Minor Storm (G1)", cssVar: "--kp-minor" },
    { min: 5, max: 5.9, label: "Moderate Storm (G2)", cssVar: "--kp-moderate" },
    { min: 6, max: 6.9, label: "Strong Storm (G3)", cssVar: "--kp-strong" },
    { min: 7, max: 7.9, label: "Severe Storm (G4)", cssVar: "--kp-severe" },
    { min: 8, max: 9, label: "Extreme Storm (G5)", cssVar: "--kp-extreme" },
  ];

  var REFRESH_SECONDS = 60;

  var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  var TICK_FONT = "10px " + FONT;
  var LABEL_FONT = "11px " + FONT;

  function kpSeverity(val) {
    for (var i = KP_SEVERITY.length - 1; i >= 0; i--) {
      if (val >= KP_SEVERITY[i].min) return KP_SEVERITY[i];
    }
    return KP_SEVERITY[0];
  }

  function getCssVar(name) {
    return getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
  }

  // ── 2. Theme Management ─────────────────────────────────

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("borealis-theme", theme);
    if (state.kpData) buildAllCharts();
  }

  function toggleTheme() {
    var current = document.documentElement.getAttribute("data-theme");
    applyTheme(current === "dark" ? "light" : "dark");
  }

  function initTheme() {
    var saved = localStorage.getItem("borealis-theme") || "light";
    document.documentElement.setAttribute("data-theme", saved);
  }

  // ── 3. Data Fetching ────────────────────────────────────

  function fetchJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(r.status + " " + r.statusText);
      return r.json();
    });
  }

  function fetchLatest() {
    return fetchJSON("/api/latest");
  }
  function fetchKp(w) {
    return fetchJSON("/api/kp?window=" + w);
  }
  function fetchBz(w) {
    return fetchJSON("/api/bz?window=" + w);
  }
  function fetchWind(w) {
    return fetchJSON("/api/wind?window=" + w);
  }

  function fetchAll(w) {
    return Promise.all([
      fetchLatest(),
      fetchKp(w),
      fetchBz(w),
      fetchWind(w),
    ]).then(function (results) {
      return {
        latest: results[0],
        kp: results[1],
        bz: results[2],
        wind: results[3],
      };
    });
  }

  // ── 4. Status Strip ─────────────────────────────────────

  function renderStatus(latest) {
    var kpBlock = document.getElementById("stat-kp");
    var bzBlock = document.getElementById("stat-bz");
    var windBlock = document.getElementById("stat-wind");

    if (latest.kp) {
      var kpVal = latest.kp.k_index;
      var sev = kpSeverity(kpVal);
      var color = getCssVar(sev.cssVar);
      kpBlock.querySelector(".stat-value").textContent = kpVal.toFixed(1);
      kpBlock.querySelector(".stat-value").style.color = color;
      kpBlock.querySelector(".stat-label").textContent = sev.label;
      kpBlock.querySelector(".stat-label").style.color = color;
    } else {
      kpBlock.querySelector(".stat-value").textContent = "\u2014";
      kpBlock.querySelector(".stat-value").style.color = "";
      kpBlock.querySelector(".stat-label").textContent = "KP Index";
      kpBlock.querySelector(".stat-label").style.color = "";
    }

    if (latest.bz) {
      var bzVal = latest.bz.bz_gsm;
      var dir = bzVal >= 0 ? "Northward" : "Southward";
      var arrow = bzVal >= 0 ? "\u2191" : "\u2193";
      var bzColor =
        bzVal >= 0 ? getCssVar("--aurora-teal") : getCssVar("--aurora-purple");
      bzBlock.querySelector(".stat-value").textContent =
        bzVal.toFixed(1) + " nT " + arrow;
      bzBlock.querySelector(".stat-value").style.color = bzColor;
      bzBlock.querySelector(".stat-label").textContent = dir;
      bzBlock.querySelector(".stat-label").style.color = bzColor;
      bzBlock.classList.toggle("stat-bz-southward", bzVal < 0);
    } else {
      bzBlock.querySelector(".stat-value").textContent = "\u2014";
      bzBlock.querySelector(".stat-value").style.color = "";
      bzBlock.querySelector(".stat-label").textContent = "Bz";
      bzBlock.querySelector(".stat-label").style.color = "";
      bzBlock.classList.remove("stat-bz-southward");
    }

    if (latest.wind) {
      var windColor = getCssVar("--aurora-green");
      windBlock.querySelector(".stat-value").textContent =
        latest.wind.speed.toFixed(0) +
        " km/s  " +
        latest.wind.density.toFixed(1) +
        " p/cm\u00B3";
      windBlock.querySelector(".stat-value").style.color = windColor;
      windBlock.querySelector(".stat-label").textContent = "Solar Wind";
      windBlock.querySelector(".stat-label").style.color = windColor;
    } else {
      windBlock.querySelector(".stat-value").textContent = "\u2014";
      windBlock.querySelector(".stat-value").style.color = "";
      windBlock.querySelector(".stat-label").textContent = "Solar Wind";
      windBlock.querySelector(".stat-label").style.color = "";
    }
  }

  // ── 5. Canvas Chart Engine ──────────────────────────────

  var state = {
    window: "3h",
    kpData: null,
    bzData: null,
    windData: null,
    countdown: REFRESH_SECONDS,
    intervalId: null,
    paused: false,
  };

  // --- Layout ---

  function computeLayout(cssW, cssH, opts) {
    opts = opts || {};
    var dpr = window.devicePixelRatio || 1;
    var left = opts.leftMargin || 55;
    var right = opts.rightMargin || 15;
    var top = opts.topMargin || 10;
    var bottom = opts.bottomMargin || 30;
    return {
      dpr: dpr,
      canvas: { width: cssW, height: cssH },
      plot: {
        left: left,
        top: top,
        width: Math.max(0, cssW - left - right),
        height: Math.max(0, cssH - top - bottom),
      },
    };
  }

  function createCanvas(container, layout) {
    container.innerHTML = "";
    var canvas = document.createElement("canvas");
    canvas.style.width = layout.canvas.width + "px";
    canvas.style.height = layout.canvas.height + "px";
    canvas.width = Math.round(layout.canvas.width * layout.dpr);
    canvas.height = Math.round(layout.canvas.height * layout.dpr);
    container.appendChild(canvas);
    var ctx = canvas.getContext("2d");
    ctx.scale(layout.dpr, layout.dpr);
    return ctx;
  }

  // --- Scales ---

  function makeScale(domainMin, domainMax, rangeMin, rangeMax) {
    var dSpan = domainMax - domainMin || 1;
    var rSpan = rangeMax - rangeMin;
    return {
      toPixel: function (v) {
        return rangeMin + ((v - domainMin) / dSpan) * rSpan;
      },
    };
  }

  function niceStep(range, targetTicks) {
    var rough = range / (targetTicks || 5);
    var mag = Math.pow(10, Math.floor(Math.log10(rough)));
    var norm = rough / mag;
    var step;
    if (norm < 1.5) step = 1;
    else if (norm < 3) step = 2;
    else if (norm < 7) step = 5;
    else step = 10;
    return step * mag;
  }

  function generateValueTicks(min, max, target) {
    target = target || 5;
    var range = max - min;
    if (range === 0) {
      return [min - 1, min, min + 1];
    }
    var step = niceStep(range, target);
    var first = Math.floor(min / step) * step;
    var ticks = [];
    for (var v = first; v <= max + step * 0.01; v += step) {
      ticks.push(Math.round(v * 1e10) / 1e10);
    }
    return ticks;
  }

  function generateTimeTicks(startMs, endMs, target) {
    target = target || 6;
    var span = endMs - startMs;
    var intervals = [
      60000, 120000, 300000, 600000, 900000, 1800000, 3600000, 7200000,
      10800000, 21600000, 43200000,
    ];
    var best = intervals[0];
    var bestDiff = Infinity;
    for (var i = 0; i < intervals.length; i++) {
      var count = span / intervals[i];
      var diff = Math.abs(count - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = intervals[i];
      }
    }
    var first = Math.ceil(startMs / best) * best;
    var ticks = [];
    for (var t = first; t <= endMs; t += best) {
      ticks.push(t);
    }
    return ticks;
  }

  // --- Drawing primitives ---

  function clearChart(ctx, layout) {
    ctx.fillStyle = getCssVar("--chart-bg");
    ctx.fillRect(0, 0, layout.canvas.width, layout.canvas.height);
  }

  function drawGridlines(ctx, layout, xTicks, yTicks, xScale, yScale) {
    var p = layout.plot;
    ctx.save();
    ctx.strokeStyle = getCssVar("--chart-grid");
    ctx.lineWidth = 1;
    for (var i = 0; i < yTicks.length; i++) {
      var y = Math.round(yScale.toPixel(yTicks[i])) + 0.5;
      ctx.beginPath();
      ctx.moveTo(p.left, y);
      ctx.lineTo(p.left + p.width, y);
      ctx.stroke();
    }
    for (var j = 0; j < xTicks.length; j++) {
      var x = Math.round(xScale.toPixel(xTicks[j])) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, p.top);
      ctx.lineTo(x, p.top + p.height);
      ctx.stroke();
    }
    ctx.restore();
  }

  function formatTime(ms) {
    var d = new Date(ms);
    return (
      d.getHours().toString().padStart(2, "0") +
      ":" +
      d.getMinutes().toString().padStart(2, "0")
    );
  }

  function drawXAxis(ctx, layout, ticks, scale, formatFn) {
    var p = layout.plot;
    formatFn = formatFn || formatTime;
    ctx.save();
    ctx.strokeStyle = getCssVar("--chart-axis");
    ctx.lineWidth = 1;

    // baseline
    var baseY = p.top + p.height + 0.5;
    ctx.beginPath();
    ctx.moveTo(p.left, baseY);
    ctx.lineTo(p.left + p.width, baseY);
    ctx.stroke();

    // ticks and labels
    ctx.fillStyle = getCssVar("--chart-axis");
    ctx.font = TICK_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (var i = 0; i < ticks.length; i++) {
      var x = Math.round(scale.toPixel(ticks[i])) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, baseY);
      ctx.lineTo(x, baseY + 4);
      ctx.stroke();
      ctx.fillText(formatFn(ticks[i]), x, baseY + 6);
    }
    ctx.restore();
  }

  function drawYAxis(ctx, layout, ticks, scale, side, color, formatFn) {
    var p = layout.plot;
    color = color || getCssVar("--chart-axis");
    formatFn = formatFn || function (v) {
      return Number.isInteger(v) ? v.toString() : v.toFixed(1);
    };
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1;
    ctx.font = TICK_FONT;

    if (side === "right") {
      var axisX = p.left + p.width + 0.5;
      ctx.beginPath();
      ctx.moveTo(axisX, p.top);
      ctx.lineTo(axisX, p.top + p.height);
      ctx.stroke();
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      for (var i = 0; i < ticks.length; i++) {
        var y = Math.round(scale.toPixel(ticks[i]));
        ctx.beginPath();
        ctx.moveTo(axisX, y);
        ctx.lineTo(axisX + 4, y);
        ctx.stroke();
        ctx.fillText(formatFn(ticks[i]), axisX + 6, y);
      }
    } else {
      var axisXL = p.left + 0.5;
      ctx.beginPath();
      ctx.moveTo(axisXL, p.top);
      ctx.lineTo(axisXL, p.top + p.height);
      ctx.stroke();
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (var j = 0; j < ticks.length; j++) {
        var yL = Math.round(scale.toPixel(ticks[j]));
        ctx.beginPath();
        ctx.moveTo(axisXL, yL);
        ctx.lineTo(axisXL - 4, yL);
        ctx.stroke();
        ctx.fillText(formatFn(ticks[j]), axisXL - 6, yL);
      }
    }
    ctx.restore();
  }

  function drawLine(ctx, layout, times, values, xScale, yScale, color, width) {
    var p = layout.plot;
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.left, p.top, p.width, p.height);
    ctx.clip();

    ctx.strokeStyle = color;
    ctx.lineWidth = width || 1.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    var started = false;
    for (var i = 0; i < times.length; i++) {
      if (values[i] == null) {
        started = false;
        continue;
      }
      var x = xScale.toPixel(times[i]);
      var y = yScale.toPixel(values[i]);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawBars(ctx, layout, times, values, xScale, yScale, colorFn) {
    var p = layout.plot;
    if (times.length === 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.left, p.top, p.width, p.height);
    ctx.clip();

    var barW = Math.max(2, Math.round((p.width / times.length) * 0.7));
    var zeroY = yScale.toPixel(0);
    for (var i = 0; i < times.length; i++) {
      if (values[i] == null) continue;
      var x = xScale.toPixel(times[i]);
      var y = yScale.toPixel(values[i]);
      ctx.fillStyle = colorFn(values[i]);
      ctx.fillRect(x - barW / 2, y, barW, zeroY - y);
    }
    ctx.restore();
  }

  function drawHorizontalRule(ctx, layout, yVal, yScale, color, dashed, label) {
    var p = layout.plot;
    var y = Math.round(yScale.toPixel(yVal)) + 0.5;
    if (y < p.top || y > p.top + p.height) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    if (dashed) ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(p.left, y);
    ctx.lineTo(p.left + p.width, y);
    ctx.stroke();
    ctx.setLineDash([]);
    if (label) {
      ctx.fillStyle = color;
      ctx.font = TICK_FONT;
      ctx.textBaseline = "bottom";
      ctx.textAlign = "left";
      ctx.fillText(label, p.left + 4, y - 3);
    }
    ctx.restore();
  }

  // ── 6. Chart Renderers ─────────────────────────────────

  function extractTimesMs(data) {
    return data.map(function (d) {
      return new Date(d.time_tag).getTime();
    });
  }

  function extractField(data, field) {
    return data.map(function (d) {
      return d[field];
    });
  }

  function renderKpChart(container, data) {
    var w = container.clientWidth;
    var h = container.clientHeight;
    if (w === 0 || h === 0) return;

    var layout = computeLayout(w, h);
    var ctx = createCanvas(container, layout);
    var p = layout.plot;

    var times = extractTimesMs(data);
    var values = extractField(data, "k_index");

    var xTicks = generateTimeTicks(times[0], times[times.length - 1], 6);
    var xMin = Math.min(times[0], xTicks[0] || times[0]);
    var xMax = Math.max(times[times.length - 1], xTicks[xTicks.length - 1] || times[times.length - 1]);
    var xScale = makeScale(xMin, xMax, p.left, p.left + p.width);
    var yScale = makeScale(0, 8, p.top + p.height, p.top);

    var yTicks = [0, 1, 2, 3, 4, 5, 6, 7, 8];

    clearChart(ctx, layout);
    drawGridlines(ctx, layout, xTicks, yTicks, xScale, yScale);
    drawBars(ctx, layout, times, values, xScale, yScale, function (v) {
      return getCssVar(kpSeverity(v).cssVar) + "b0";
    });

    // threshold lines
    var thresholds = [
      { y: 3, label: "Unsettled", cssVar: "--kp-unsettled" },
      { y: 5, label: "G1", cssVar: "--kp-minor" },
      { y: 7, label: "G4", cssVar: "--kp-severe" },
    ];
    for (var i = 0; i < thresholds.length; i++) {
      drawHorizontalRule(
        ctx, layout, thresholds[i].y, yScale,
        getCssVar(thresholds[i].cssVar) + "60", true, thresholds[i].label
      );
    }

    drawXAxis(ctx, layout, xTicks, xScale);
    drawYAxis(ctx, layout, yTicks, yScale, "left");
  }

  function renderBzChart(container, data) {
    var w = container.clientWidth;
    var h = container.clientHeight;
    if (w === 0 || h === 0) return;

    var layout = computeLayout(w, h);
    var ctx = createCanvas(container, layout);
    var p = layout.plot;

    var times = extractTimesMs(data);
    var values = extractField(data, "bz_gsm");

    var min = Infinity, max = -Infinity;
    for (var i = 0; i < values.length; i++) {
      if (values[i] == null) continue;
      if (values[i] < min) min = values[i];
      if (values[i] > max) max = values[i];
    }
    // ensure 0 is in range
    if (min > 0) min = 0;
    if (max < 0) max = 0;
    // add padding so data doesn't touch axis edges
    var pad = Math.max((max - min) * 0.15, 2);
    min -= pad;
    max += pad;

    var yTicks = generateValueTicks(min, max, 5);
    // extend scale to cover tick range
    var scaleMin = yTicks[0];
    var scaleMax = yTicks[yTicks.length - 1];

    var xTicks = generateTimeTicks(times[0], times[times.length - 1], 6);
    var xMin = Math.min(times[0], xTicks[0] || times[0]);
    var xMax = Math.max(times[times.length - 1], xTicks[xTicks.length - 1] || times[times.length - 1]);
    var xScale = makeScale(xMin, xMax, p.left, p.left + p.width);
    var yScale = makeScale(scaleMin, scaleMax, p.top + p.height, p.top);

    clearChart(ctx, layout);
    drawGridlines(ctx, layout, xTicks, yTicks, xScale, yScale);

    // zero line
    drawHorizontalRule(ctx, layout, 0, yScale, getCssVar("--chart-axis") + "80", true);

    drawLine(ctx, layout, times, values, xScale, yScale, getCssVar("--aurora-teal"), 1.5);
    drawXAxis(ctx, layout, xTicks, xScale);
    drawYAxis(ctx, layout, yTicks, yScale, "left");
  }

  function renderWindChart(container, data) {
    var w = container.clientWidth;
    var h = container.clientHeight;
    if (w === 0 || h === 0) return;

    var layout = computeLayout(w, h, { rightMargin: 55 });
    var ctx = createCanvas(container, layout);
    var p = layout.plot;

    var times = extractTimesMs(data);
    var speeds = extractField(data, "speed");
    var densities = extractField(data, "density");

    // auto-scale speed
    var sMin = Infinity, sMax = -Infinity;
    for (var i = 0; i < speeds.length; i++) {
      if (speeds[i] == null) continue;
      if (speeds[i] < sMin) sMin = speeds[i];
      if (speeds[i] > sMax) sMax = speeds[i];
    }
    var sPad = Math.max((sMax - sMin) * 0.15, 10);
    sMin = Math.max(0, sMin - sPad);
    sMax += sPad;
    var sTicks = generateValueTicks(sMin, sMax, 5);
    var sScaleMin = sTicks[0];
    var sScaleMax = sTicks[sTicks.length - 1];

    // auto-scale density
    var dMin = Infinity, dMax = -Infinity;
    for (var j = 0; j < densities.length; j++) {
      if (densities[j] == null) continue;
      if (densities[j] < dMin) dMin = densities[j];
      if (densities[j] > dMax) dMax = densities[j];
    }
    var dPad = Math.max((dMax - dMin) * 0.15, 1);
    dMin = Math.max(0, dMin - dPad);
    dMax += dPad;
    var dTicks = generateValueTicks(dMin, dMax, 5);
    var dScaleMin = dTicks[0];
    var dScaleMax = dTicks[dTicks.length - 1];

    var xTicks = generateTimeTicks(times[0], times[times.length - 1], 6);
    var xMin = Math.min(times[0], xTicks[0] || times[0]);
    var xMax = Math.max(times[times.length - 1], xTicks[xTicks.length - 1] || times[times.length - 1]);
    var xScale = makeScale(xMin, xMax, p.left, p.left + p.width);
    var speedScale = makeScale(sScaleMin, sScaleMax, p.top + p.height, p.top);
    var densityScale = makeScale(dScaleMin, dScaleMax, p.top + p.height, p.top);

    clearChart(ctx, layout);
    // gridlines only for speed (left) axis
    drawGridlines(ctx, layout, xTicks, sTicks, xScale, speedScale);

    var greenColor = getCssVar("--aurora-green");
    var yellowColor = getCssVar("--aurora-yellow");

    drawLine(ctx, layout, times, speeds, xScale, speedScale, greenColor, 1.5);
    drawLine(ctx, layout, times, densities, xScale, densityScale, yellowColor, 1.5);

    drawXAxis(ctx, layout, xTicks, xScale);
    drawYAxis(ctx, layout, sTicks, speedScale, "left", greenColor);
    drawYAxis(ctx, layout, dTicks, densityScale, "right", yellowColor);
  }

  // ── 7. Chart Building ──────────────────────────────────

  function buildAllCharts() {
    var kpEl = document.getElementById("chart-kp-container");
    var bzEl = document.getElementById("chart-bz-container");
    var windEl = document.getElementById("chart-wind-container");

    if (state.kpData && state.kpData.length > 0) {
      renderKpChart(kpEl, state.kpData);
    } else {
      showChartError("chart-kp-container",
        state.kpData ? "No data for selected window" : "Unable to load data");
    }
    if (state.bzData && state.bzData.length > 0) {
      renderBzChart(bzEl, state.bzData);
    } else {
      showChartError("chart-bz-container",
        state.bzData ? "No data for selected window" : "Unable to load data");
    }
    if (state.windData && state.windData.length > 0) {
      renderWindChart(windEl, state.windData);
    } else {
      showChartError("chart-wind-container",
        state.windData ? "No data for selected window" : "Unable to load data");
    }
    return true;
  }

  function showChartError(containerId, msg) {
    var el = document.getElementById(containerId);
    el.innerHTML = '<div class="chart-error">' + msg + "</div>";
  }

  // ── 8. Window Selector ─────────────────────────────────

  function setWindow(w) {
    state.window = w;
    document
      .querySelectorAll(".window-selector button")
      .forEach(function (btn) {
        btn.classList.toggle("active", btn.getAttribute("data-window") === w);
      });
    Promise.all([fetchKp(w), fetchBz(w), fetchWind(w)])
      .then(function (results) {
        state.kpData = results[0];
        state.bzData = results[1];
        state.windData = results[2];
        buildAllCharts();
      })
      .catch(function (err) {
        console.error("Failed to fetch chart data:", err);
      });
  }

  // ── 9. Auto-Refresh ────────────────────────────────────

  var countdownEl, toggleEl;

  function updateCountdownDisplay() {
    if (state.paused) {
      countdownEl.textContent = "";
      toggleEl.textContent = "\u25B6";
    } else {
      countdownEl.textContent = "\u27F3 " + state.countdown + "s";
      toggleEl.textContent = "\u23F8";
    }
  }

  function tickCountdown() {
    state.countdown--;
    if (state.countdown <= 0) {
      refreshData();
      state.countdown = REFRESH_SECONDS;
    }
    updateCountdownDisplay();
  }

  function startCountdown() {
    state.countdown = REFRESH_SECONDS;
    state.intervalId = setInterval(tickCountdown, 1000);
    updateCountdownDisplay();
  }

  function pauseCountdown() {
    state.paused = true;
    if (state.intervalId) {
      clearInterval(state.intervalId);
      state.intervalId = null;
    }
    localStorage.setItem("borealis-autorefresh", "false");
    updateCountdownDisplay();
  }

  function resumeCountdown() {
    state.paused = false;
    state.countdown = REFRESH_SECONDS;
    startCountdown();
    localStorage.setItem("borealis-autorefresh", "true");
  }

  function toggleRefresh() {
    if (state.paused) {
      resumeCountdown();
    } else {
      pauseCountdown();
    }
  }

  function refreshData() {
    fetchAll(state.window)
      .then(function (data) {
        renderStatus(data.latest);
        state.kpData = data.kp;
        state.bzData = data.bz;
        state.windData = data.wind;
        buildAllCharts();
      })
      .catch(function (err) {
        console.error("Auto-refresh failed:", err);
      });
  }

  // ── 10. ResizeObserver ─────────────────────────────────

  function setupResizeObservers() {
    var lastWidth = 0;
    var lastHeight = 0;
    var resizeTimer = null;
    var grid = document.querySelector(".chart-grid");
    new ResizeObserver(function () {
      var w = grid.clientWidth;
      var h = grid.clientHeight;
      if (w === lastWidth && h === lastHeight) return;
      lastWidth = w;
      lastHeight = h;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (state.kpData) buildAllCharts();
      }, 50);
    }).observe(grid);
  }

  // ── 11. Init ───────────────────────────────────────────

  function init() {
    initTheme();

    countdownEl = document.querySelector(".refresh-countdown");
    toggleEl = document.querySelector(".refresh-toggle");

    document
      .querySelector(".theme-toggle")
      .addEventListener("click", toggleTheme);
    toggleEl.addEventListener("click", toggleRefresh);

    document
      .querySelectorAll(".window-selector button")
      .forEach(function (btn) {
        btn.addEventListener("click", function () {
          setWindow(btn.getAttribute("data-window"));
        });
      });

    setupResizeObservers();

    fetchAll(state.window)
      .then(function (data) {
        state.kpData = data.kp;
        state.bzData = data.bz;
        state.windData = data.wind;
        renderStatus(data.latest);
        buildAllCharts();
      })
      .catch(function (err) {
        console.error("Initial data load failed:", err);
        if (!state.kpData) {
          showChartError("chart-kp-container", "Unable to load data");
          showChartError("chart-bz-container", "Unable to load data");
          showChartError("chart-wind-container", "Unable to load data");
        }
      });

    var savedRefresh = localStorage.getItem("borealis-autorefresh");
    if (savedRefresh === "false") {
      state.paused = true;
      updateCountdownDisplay();
    } else {
      startCountdown();
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
