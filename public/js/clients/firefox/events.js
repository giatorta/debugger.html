"use strict";

const { Source, Frame, Location } = require("../../types");

const CALL_STACK_PAGE_SIZE = 25;
const NEW_SOURCE_IGNORED_URLS = ["debugger eval code", "XStringBundle"];

let threadClient;
let actions;

function setupEvents(dependencies) {
  threadClient = dependencies.threadClient;
  actions = dependencies.actions;
}

function createFrame(frame) {
  let title;
  if (frame.type == "call") {
    let c = frame.callee;
    title = c.name || c.userDisplayName || c.displayName || "(anonymous)";
  } else {
    title = "(" + frame.type + ")";
  }

  return Frame({
    id: frame.actor,
    displayName: title,
    location: Location({
      sourceId: frame.where.source.actor,
      line: frame.where.line,
      column: frame.where.column
    }),
    scope: frame.environment
  });
}

function paused(_, packet) {
  // If paused by an explicit interrupt, which are generated by the
  // slow script dialog and internal events such as setting
  // breakpoints, ignore the event.
  if (packet.why.type === "interrupted" && !packet.why.onNext) {
    return;
  }

  // Eagerly fetch the frames
  threadClient.getFrames(0, CALL_STACK_PAGE_SIZE, res => {
    actions.loadedFrames(res.frames.map(createFrame));
  });

  const pause = Object.assign({}, packet, {
    frame: createFrame(packet.frame)
  });
  actions.paused(pause);
}

function resumed(_, packet) {
  actions.resumed(packet);
}

function newSource(_, packet) {
  const { source } = packet;

  if (NEW_SOURCE_IGNORED_URLS.indexOf(source.url) > -1) {
    return;
  }
  actions.newSource(Source({
    id: source.actor,
    url: source.url,
    isPrettyPrinted: source.isPrettyPrinted,
    sourceMapURL: source.sourceMapURL
  }));
}

const clientEvents = {
  paused,
  resumed,
  newSource
};

module.exports = {
  setupEvents,
  clientEvents
};
