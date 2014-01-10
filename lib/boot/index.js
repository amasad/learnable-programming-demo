var d3 = require('d3');
var dom = require('dom');
var debugjs = require('debugjs');
var debounce = require('debounce');
var CodeMirror = require('codemirror');

require('codemirror-mode-javascript')(CodeMirror);

var editor = new CodeMirror(dom('.editor')[0]);
var debug = debugjs.createDebugger({
  iframeParentElement: dom('.result')[0]
});
var iframe = debug.machine.context.iframe;
iframe.style.display = 'block';

// iframe loaded?
var loaded = false;

debug.machine.on('error', function (err) {
  console.error(err.message);
});

/**
 * Html code
 */

iframe.contentDocument.open();
iframe.contentDocument.write(
  '<!DOCTYPE html><html><head></head><body><canvas width="300px"></canvas>'+
  '<script src="processing.js"></script></body></html>'
);
iframe.contentDocument.close();

/**
 * Example code
 */

var exampleCode = [
  'var shift = 0;',
  'while (shift <= 200) {',
  '  if (shift % 3) {',
  '    stroke(0, 0, 0, 52);',
  '  } else {',
  '    stroke(0, 0, 0, 128);',
  '  }',
  '  line(shift, 0, 230, shift);',
  '  shift += 14;',
  '}'
].join('\n');

/**
 * Processing bootstrap code
 */

var bootstrapCode = [
  'var canvas = document.querySelector("canvas");',
  'var processingInstance = new Processing(canvas, function (processing) {',
  '  processing.background(255);',
  '  processing.size(230, 300);',
  '  for (prop in processing)',
  '    if (typeof processing[prop] === "function" && !window[prop])',
  '      window[prop] = processing[prop]',
  '  __wrapListener(sketchProc)(processing);',
  '});'
].join('\n');

/**
 * Update editor zebra lines
 */

editor.on('change', function () {
  editor.getValue().split('\n').forEach(function (_, i) {
    if (i%2!=0) editor.addLineClass(i, 'background', 'odd');
    else editor.removeLineClass(i, 'background', 'odd');
  });
});

/**
 * Run code on change
 */

editor.on('change', debounce(function () {
  if (loaded) loadCode(editor.getValue());
}, 250));

editor.setValue(exampleCode);

/**
 * Load the code in debugjs
 * @param {string} code
 */
var fid = 0;
function loadCode(code) {
  dom('.plot').empty();
  code = 'window.sketchProc = function (processing) {\n' + code;
  code = code + '\n}';
  var filename = 'file' + (++fid);
  debug.load(code, filename);
  debug.addBreakpoints(filename, [2]);
  debug.once('breakpoint', function () {
    var i = 0;
    var steps = [];
    while (!debug.halted()) {
      var point = {
        y: debug.getCurrentLoc().start.line - 1,
        x: i + 1
      };
      steps.push(point);
      debug.stepOver();
      i++;
    }
    dom('.step-no').text(i);
    start(i, editor.getValue().split('\n').length + 1, steps);
  });
  debug.run();
  debug.machine.$evaluate(bootstrapCode);
}

iframe.onload = function () {
  loadCode(exampleCode);
  loaded = true;
};

/**
 * Stepping and plot logic
 * @param {int} max
 * @param {int} maxY
 * @param {array<object>} steps
 */
function start(max, maxY, steps) {
  dom('input').attr('max', max);

  var highlighted = null;
  /**
   * Go to a step in the code, running previous steps
   * @param {int} val
   */
  function gotoStep(val) {
    dom('.step-no').text(val);
    if (highlighted != null) {
      editor.removeLineClass(highlighted, 'highlight', 'highlight');
    }
    if (steps[val - 1]) {
      editor.addLineClass(steps[val - 1].y - 1 , 'highlight', 'highlight');
      highlighted = steps[val - 1].y - 1;
    }
    var handler = function () {
      for (var i = 0; i < val; i++) {
        debug.stepOver();
      }
    };
    debug.once('breakpoint', handler);
    debug.run();
    debug.machine.$evaluate(bootstrapCode);
  }

  var w = dom('.plot')[0].clientWidth;
  w = Math.max(w * (max / 50), w);

  var margin = {top: 20, right: 20, bottom: 30, left: 5},
    width = w - margin.left - margin.right,
    height = 300 - margin.top - margin.bottom;

  /**
   * Scales
   */

  var x = d3.scale.linear()
      .domain([0, max])
      .range([0, width]);
  var y = d3.scale.linear()
      .domain([0, 10])
      .range([0, height]);


  /**
   * Axis
   */

  var tickValues = [];
  for (var j = 0; j < max; j += 10) {
    tickValues.push(j);
  }
  if (tickValues[tickValues.length - 1] !== max) tickValues.push(max);

  var xAxis = d3.svg.axis()
      .scale(x)
      .orient("top")
      .ticks(40)
      .tickSize(6, 6)
      .tickValues(tickValues);


  /**
   * Draw
   */

  var svg = d3.select(".plot").append("svg")
      .attr("width", width + margin.left + margin.right)
      .attr("height", height + margin.top + margin.bottom)
    .append("g")
      .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

  svg.append("g")
      .attr("class", "x axis")
      .call(xAxis);

  for (var i = 0; i < maxY; i++) {
    var cls = 'line';
    if (i === 0) cls += ' ' + 'first';
    svg
      .append('line')
      .attr('class', cls)
      .attr('x1', x(0) - margin.left)
      .attr('x2', x(max) + margin.right)
      .attr('y1', y(i))
      .attr('y2', y(i));
  }

  svg.selectAll(".dot")
      .data(steps)
    .enter().append("circle")
      .attr("class", function (d) { return "dot " + "dot" + d.x})
      .attr("r", 3.5)
      .attr("cx", function(d) { return x(d.x); })
      .attr("cy", function(d) { return y(d.y); });

  /**
   * On mousemove
   */

  d3.select('svg').on('mousemove', function () {
    var cords = d3.mouse(this);
    var cx = cords[0];
    var xx = Math.round(x.invert(cx - margin.left));
    if (xx > max) return;
    d3.select('.dot.highlight').classed('highlight', false);
    d3.selectAll('.dot.active').classed('active', false);

    d3.select('.dot' + xx).classed('highlight', true);
    for (var i = xx; i > -1; i--) {
      d3.select('.dot' + i).classed('active', true);
    }
    gotoStep(xx);
    d3.select(this).select(".marker").remove();
    d3.select(this).append("line")
      .attr("class", "marker")
      .attr("x1", cx)
      .attr("y1", 0)
      .attr("x2", cx)
      .attr("y2", height + margin.top + margin.bottom)
      .style("stroke", "red")
      .style("width", "30");
  });
}
