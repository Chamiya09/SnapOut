figma.showUI(__html__, { width: 320, height: 260 });

figma.ui.onmessage = (msg) => {
  if (msg.type === "import") {
    const tree = JSON.parse(msg.data);

    const root = figma.createFrame();
    root.name = "Imported Page";
    root.x = 0;
    root.y = 0;
    root.resize(Math.max(tree.width, 1), Math.max(tree.height, 1));
    figma.currentPage.appendChild(root);

    buildNode(tree, root, tree.x, tree.y);

    figma.viewport.scrollAndZoomIntoView([root]);
    figma.notify("Import complete");
  }
};

function buildNode(data, parent, originX, originY) {
  // Skip the very outer node itself — it's already represented by `root`
  for (const child of data.children || []) {
    const frame = figma.createFrame();
    frame.name = child.tag;
    frame.x = child.x - originX;
    frame.y = child.y - originY;
    frame.resize(Math.max(child.width, 1), Math.max(child.height, 1));
    frame.fills = []; // transparent by default, we'll add real color mapping next step
    parent.appendChild(frame);

    buildNode(child, frame, originX, originY);
  }
}
