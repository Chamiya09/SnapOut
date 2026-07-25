figma.showUI(__html__, { width: 320, height: 260 });

figma.ui.onmessage = async (msg) => {
  if (msg.type === "import") {
    const tree = JSON.parse(msg.data);
    console.log("tree.backgroundColor:", tree.backgroundColor);
    console.log(
      "parseFill result:",
      JSON.stringify(parseFill(tree.backgroundColor)),
    );

    const root = figma.createFrame();
    root.name = "Imported Page";
    root.x = 0;
    root.y = 0;
    root.resize(Math.max(tree.width, 1), Math.max(tree.height, 1));
    root.fills = parseFill(tree.backgroundColor);
    figma.currentPage.appendChild(root);

    await buildNode(tree, root, tree.x, tree.y);

    figma.viewport.scrollAndZoomIntoView([root]);
    figma.notify("Import complete");
  }
};

async function buildNode(data, parent, originX, originY) {
  for (const child of data.children || []) {
    const frame = figma.createFrame();
    frame.name = child.tag;
    if (child.imageData) {
      try {
        const bytes = base64ToUint8Array(child.imageData);
        const image = figma.createImage(bytes);
        frame.fills = [
          { type: "IMAGE", scaleMode: "FILL", imageHash: image.hash },
        ];
      } catch (err) {
        console.log(
          "Image failed to load, falling back to background color:",
          err,
        );
        frame.fills = parseFill(child.backgroundColor);
      }
    } else {
      frame.fills = parseFill(child.backgroundColor);
    }

    if (child.display === "flex") {
      applyAutoLayout(frame, child);
    } else {
      frame.x = child.x - originX;
      frame.y = child.y - originY;
      frame.resize(Math.max(child.width, 1), Math.max(child.height, 1));
    }

    parent.appendChild(frame);

    if (!child.display || child.display !== "flex") {
      // already sized/positioned above
    }

    if (child.text) {
      await addText(child, frame);
    }

    await buildNode(child, frame, originX, originY);

    if (child.display === "flex") {
      // resize AFTER children are added, since auto-layout frames
      // size themselves based on content once layoutMode is set
      frame.x = child.x - originX;
      frame.y = child.y - originY;
    }
  }
}

function applyAutoLayout(frame, data) {
  frame.layoutMode =
    data.flexDirection === "column" ? "VERTICAL" : "HORIZONTAL";

  const justifyMap = {
    "flex-start": "MIN",
    center: "CENTER",
    "flex-end": "MAX",
    "space-between": "SPACE_BETWEEN",
  };
  frame.primaryAxisAlignItems = justifyMap[data.justifyContent] || "MIN";

  const alignMap = {
    "flex-start": "MIN",
    center: "CENTER",
    "flex-end": "MAX",
    normal: "MIN",
    stretch: "MIN",
  };
  frame.counterAxisAlignItems = alignMap[data.alignItems] || "MIN";

  const gapValue = parseFloat(data.gap);
  frame.itemSpacing = isNaN(gapValue) ? 0 : gapValue;

  frame.primaryAxisSizingMode = "AUTO";
  frame.counterAxisSizingMode = "AUTO";
}

async function addText(data, parentFrame) {
  const font = resolveFont(data.fontFamily, data.fontWeight);
  await figma.loadFontAsync(font);

  const textNode = figma.createText();
  textNode.fontName = font;
  textNode.characters = data.text;
  textNode.fontSize = parseFloat(data.fontSize) || 16;
  textNode.fills = parseFill(data.color);

  textNode.x = 0;
  textNode.y = 0;
  parentFrame.appendChild(textNode);
}

function parseFill(cssColor) {
  if (!cssColor) return [];

  const match = cssColor.match(/rgba?\(([^)]+)\)/);
  if (!match) return [];

  const parts = match[1].split(",").map((n) => parseFloat(n.trim()));
  const [r, g, b, a = 1] = parts;

  if (a === 0) return []; // fully transparent — don't add a fill at all

  return [
    {
      type: "SOLID",
      color: { r: r / 255, g: g / 255, b: b / 255 },
      opacity: a,
    },
  ];
}

function base64ToUint8Array(base64String) {
  const base64 = base64String.split(",")[1]; // strip the "data:image/jpeg;base64," prefix
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function resolveFont(fontFamilyString, fontWeight) {
  const bold = parseInt(fontWeight, 10) >= 600;

  // Figma's default, always-available font. Everything falls back to this for now.
  const family = "Inter";
  const style = bold ? "Bold" : "Regular";

  return { family, style };
}
