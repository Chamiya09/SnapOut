figma.showUI(__html__, { width: 320, height: 260 });

figma.ui.onmessage = (msg) => {
  if (msg.type === "import") {
    const tree = JSON.parse(msg.data);

    const frame = figma.createFrame();
    frame.name = "Imported Page";
    frame.x = 0;
    frame.y = 0;
    frame.resize(Math.max(tree.width, 1), Math.max(tree.height, 1));

    figma.currentPage.appendChild(frame);
    figma.viewport.scrollAndZoomIntoView([frame]);
    figma.notify("Created frame: " + tree.width + " x " + tree.height);
  }
};
