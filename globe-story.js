const regions = {
  western_na: { label: "Western North America", center: [-120, 38] },
  south_asia: { label: "South Asia", center: [78, 20] },
  sahel: { label: "Sahel", center: [5, 15] }
};
const colors = { "SSP2-4.5": "#287d9b", "SSP5-8.5": "#cb7046" };
const globeSvg = d3.select("#globe");
const globeG = globeSvg.append("g");
const globeProjection = d3.geoOrthographic().translate([180, 180]).scale(164).clipAngle(90);
const globePath = d3.geoPath(globeProjection);
globeG.append("path").datum({ type: "Sphere" }).attr("class", "sphere");
globeG.append("path").datum(d3.geoGraticule10()).attr("class", "graticule");
const landPath = globeG.append("path").attr("class", "land");
const focusPoint = globeG.append("circle").attr("class", "focus-point").attr("r", 6);

function drawGlobe() {
  globeG.select(".sphere").attr("d", globePath);
  globeG.select(".graticule").attr("d", globePath);
  if (window.landFeatures) landPath.datum(window.landFeatures).attr("d", globePath);
  const center = regions[window.activeRegion || "western_na"].center;
  const point = globeProjection(center);
  focusPoint.attr("cx", point ? point[0] : -100).attr("cy", point ? point[1] : -100);
}

function turnTo(regionId, activeStep) {
  if (!regions[regionId]) return;
  window.activeRegion = regionId;
  if (activeStep) d3.selectAll(".step").classed("is-active", function() { return this === activeStep; });
  d3.select("#region-name").text(regions[regionId].label);
  const [lon, lat] = regions[regionId].center;
  const start = globeProjection.rotate();
  const target = [-lon, -lat, 0];
  const interpolate = d3.interpolateArray(start, target);
  const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 900;
  d3.transition().duration(duration).tween("globe-turn", () => t => {
    globeProjection.rotate(interpolate(t));
    drawGlobe();
  });
  drawChart(regionId);
}

function drawChart(regionId) {
  if (!window.temperatureRows) return;
  const svg = d3.select("#chart");
  svg.selectAll("*").remove();
  const width = 420, height = 320;
  const margin = { top: 34, right: 14, bottom: 58, left: 50 };
  const rows = window.temperatureRows.filter(d => d.region === regionId);
  const scenarios = ["SSP2-4.5", "SSP5-8.5"];
  const seasons = [
    { name: "Winter", abbreviation: "DJF", months: [12, 1, 2] },
    { name: "Spring", abbreviation: "MAM", months: [3, 4, 5] },
    { name: "Summer", abbreviation: "JJA", months: [6, 7, 8] },
    { name: "Autumn", abbreviation: "SON", months: [9, 10, 11] }
  ];
  const historical = new Map(rows.filter(d => d.scenario === "Historical baseline")
    .map(d => [`${d.model}|${d.month}`, d.temperature_c]));
  const changes = rows.filter(d => d.scenario !== "Historical baseline").map(d => ({
    model: d.model,
    scenario: d.scenario,
    month: d.month,
    change: d.temperature_c - historical.get(`${d.model}|${d.month}`)
  })).filter(d => Number.isFinite(d.change));
  const grouped = scenarios.map(scenario => {
    const values = seasons.map(season => {
      const modelValues = d3.rollups(
        changes.filter(d => d.scenario === scenario && season.months.includes(d.month)),
        items => d3.mean(items, d => d.change),
        d => d.model
      ).map(([model, change]) => ({ model, change }));
      return {
        season: season.name,
        abbreviation: season.abbreviation,
        median: d3.median(modelValues, d => d.change),
        low: d3.min(modelValues, d => d.change),
        high: d3.max(modelValues, d => d.change),
        models: modelValues.length
      };
    });
    return { scenario, values };
  });
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxAbs = d3.max(grouped.flatMap(series => series.values.flatMap(d => [Math.abs(d.low), Math.abs(d.high)]))) || 1;
  const extent = Math.max(1, Math.ceil(maxAbs * 2) / 2);
  const x = d3.scaleBand().domain(seasons.map(d => d.name)).range([margin.left, margin.left + plotWidth]).padding(.18);
  const y = d3.scaleLinear().domain([-extent * .12, extent * 1.08]).nice().range([margin.top + plotHeight, margin.top]);
  svg.append("text").attr("class", "chart-title").attr("x", margin.left).attr("y", 16).text("SEASONAL WARMING · °C");
  svg.append("g").attr("class", "grid").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(4).tickSize(-plotWidth).tickFormat(""));
  svg.append("line").attr("class", "zero-line").attr("x1", margin.left).attr("x2", margin.left + plotWidth)
    .attr("y1", y(0)).attr("y2", y(0));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${margin.top + plotHeight})`)
    .call(d3.axisBottom(x));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(4).tickFormat(value => value > 0 ? `+${value}` : `${value}`));
  seasons.forEach(season => svg.append("text").attr("class", "chart-title")
    .attr("text-anchor", "middle").attr("font-size", 8)
    .attr("x", x(season.name) + x.bandwidth() / 2).attr("y", height - 5).text(season.abbreviation));
  const line = d3.line().x(d => x(d.season) + x.bandwidth() / 2).y(d => y(d.median)).defined(d => Number.isFinite(d.median)).curve(d3.curveMonotoneX);
  const area = d3.area().x(d => x(d.season) + x.bandwidth() / 2).y0(d => y(d.low)).y1(d => y(d.high))
    .defined(d => Number.isFinite(d.low) && Number.isFinite(d.high)).curve(d3.curveMonotoneX);
  grouped.forEach(series => {
    const color = colors[series.scenario];
    if (series.values.some(d => d.models > 1)) svg.append("path").datum(series.values).attr("class", "ribbon").attr("fill", color).attr("d", area);
    svg.append("path").datum(series.values).attr("class", "series-line").attr("stroke", color).attr("d", line);
    svg.selectAll(`.dot-${series.scenario.replaceAll(/[^a-z0-9]/gi, "")}`).data(series.values.filter(d => Number.isFinite(d.median))).join("circle")
      .attr("class", "series-point").attr("r", 2.8).attr("cx", d => x(d.season) + x.bandwidth() / 2).attr("cy", d => y(d.median)).attr("fill", color);
  });
  const modelCount = d3.max(grouped.flatMap(series => series.values.map(d => d.models))) || 0;
  d3.select("#chart-caption").text(modelCount > 1
    ? `Median of ${modelCount} paired model families; shaded bands show their full range.`
    : "One paired model family; a model range is unavailable.");
}

async function loadTemperature() {
  const status = d3.select("#data-status");
  try {
    const response = await fetch("data/temperature_seasonality.csv", { cache: "no-store" });
    if (!response.ok) throw new Error("No extracted temperature CSV yet");
    const text = await response.text();
    const rows = d3.csvParse(text, d => ({
      ...d,
      month: +d.month,
      temperature_c: +d.temperature_c
    }));
    if (!rows.length) throw new Error("The extracted temperature CSV is empty");
    window.temperatureRows = rows;
    status.text("CMIP6 EXTRACTED · REGIONAL DATA");
    status.classed("status-note", false).classed("live-note", true);
    return true;
  } catch (error) {
    window.temperatureRows = null;
    status.text("CMIP6 DATA NOT FOUND · RUN THE EXTRACTION NOTEBOOK");
    status.classed("status-note", false).classed("missing-note", true);
    const svg = d3.select("#chart");
    svg.selectAll("*").remove();
    svg.append("text").attr("class", "chart-title").attr("text-anchor", "middle")
      .attr("x", 210).attr("y", 155).text("Run the extraction notebook to load data");
    d3.select("#chart-caption").text("The chart requires data/temperature_seasonality.csv.");
    return false;
  }
}

d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json").then(world => {
  window.landFeatures = topojson.feature(world, world.objects.land);
  drawGlobe();
}).catch(() => drawGlobe());

loadTemperature().then(() => turnTo("western_na", document.querySelector(".step")));
const observer = new IntersectionObserver(entries => {
  const active = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
  if (active) turnTo(active.target.dataset.region, active.target);
}, { rootMargin: "-30% 0px -38% 0px", threshold: [0, .2, .5, .8] });
document.querySelectorAll(".step").forEach(step => observer.observe(step));
