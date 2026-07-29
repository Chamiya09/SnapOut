figma.showUI(__html__, { width: 320, height: 260 });

figma.ui.onmessage = async (msg) => {
  if (msg.type === "import") {
    const tree = JSON.parse(msg.data);

    const root = figma.createFrame();
    root.name = "Imported Page";
    root.x = 0;
    root.y = 0;
    root.resize(Math.max(tree.width, 1), Math.max(tree.height, 1));
    root.fills = parseFill(tree.backgroundColor);

    root.clipsContent = false;

    figma.currentPage.appendChild(root);

    await buildNode(tree, root, tree.x, tree.y);

    figma.viewport.scrollAndZoomIntoView([root]);
    figma.notify("Import complete");
  }
};

// --- NEW: SVG Dimension Rewriter ---
// Forces Figma to scale the vector paths mathematically during import
// --- NEW: SVG Dimension Rewriter & Sanitizer ---
function resizeSvgString(svgString, width, height) {
  // 1. Figma crashes if it sees <?xml> or <!DOCTYPE>. Strip everything before <svg>!
  const svgStart = svgString.indexOf("<svg");
  if (svgStart !== -1) {
    svgString = svgString.substring(svgStart);
  }

  // 2. Inject the exact pixel dimensions to force perfect scaling
  return svgString.replace(/<svg\b([^>]*)>/i, (match, attributes) => {
    let cleanAttrs = attributes
      .replace(/\bwidth\s*=\s*["'][^"']*["']/gi, "")
      .replace(/\bheight\s*=\s*["'][^"']*["']/gi, "");
    return `<svg width="${Math.max(width, 1)}" height="${Math.max(height, 1)}" ${cleanAttrs}>`;
  });
}

async function buildNode(data, parent, originX, originY) {
  for (const child of data.children || []) {
    if (!child || typeof child !== "object") continue;

    try {
      // --- 1. RAW SVG IMPORT ENGINE ---
      if (child.tag === "svg" && child.svgCode) {
        try {
          const resizedSvg = resizeSvgString(
            child.svgCode,
            child.width,
            child.height,
          );
          const svgNode = figma.createNodeFromSvg(resizedSvg);
          svgNode.name = "Vector Asset";
          svgNode.x = child.x - originX;
          svgNode.y = child.y - originY;

          if (child.position === "absolute" || child.position === "fixed") {
            svgNode.layoutPositioning = "ABSOLUTE";
          }
          if (
            parent.layoutMode &&
            parent.layoutMode !== "NONE" &&
            svgNode.layoutPositioning !== "ABSOLUTE"
          ) {
            svgNode.layoutAlign = "INHERIT";
          }

          parent.appendChild(svgNode);
          continue;
        } catch (svgErr) {
          console.log("Failed parsing vector asset node:", svgErr);
        }
      }

      // --- 2. SVG IMAGE INTERCEPTOR ---
      if (child.imageData && child.imageData.includes("image/svg+xml")) {
        try {
          const base64 = child.imageData.split(",")[1];
          let svgString = atob(base64);
          try {
            svgString = decodeURIComponent(escape(svgString));
          } catch (decodeErr) {}

          const resizedSvg = resizeSvgString(
            svgString,
            child.width,
            child.height,
          );
          const svgNode = figma.createNodeFromSvg(resizedSvg);
          svgNode.name = "Vector Image";
          svgNode.x = child.x - originX;
          svgNode.y = child.y - originY;

          if (child.position === "absolute" || child.position === "fixed") {
            svgNode.layoutPositioning = "ABSOLUTE";
          }
          if (
            parent.layoutMode &&
            parent.layoutMode !== "NONE" &&
            svgNode.layoutPositioning !== "ABSOLUTE"
          ) {
            svgNode.layoutAlign = "INHERIT";
          }

          parent.appendChild(svgNode);
          continue;
        } catch (svgErr) {
          console.log("Failed decoding SVG image:", svgErr);
        }
      }

      // --- 3. STANDARD FRAME & IMAGE GENERATION ---
      const frame = figma.createFrame();
      frame.name = child.tag || "node";

      const relativeX = child.x - originX;
      const relativeY = child.y - originY;

      if (child.imageData && !child.imageData.includes("image/svg+xml")) {
        try {
          const bytes = base64ToUint8Array(child.imageData);
          const image = figma.createImage(bytes);
          frame.fills = [
            { type: "IMAGE", scaleMode: "FILL", imageHash: image.hash },
          ];
        } catch (err) {
          frame.fills = parseFill(child.backgroundColor);
        }
      } else {
        frame.fills = parseFill(child.backgroundColor);
      }

      frame.x = relativeX;
      frame.y = relativeY;
      frame.resize(Math.max(child.width, 1), Math.max(child.height, 1));

      if (child.display === "flex" || child.display === "inline-flex") {
        applyAutoLayout(frame, child);
        frame.primaryAxisSizingMode = "FIXED";
        frame.counterAxisSizingMode = "FIXED";
        frame.clipsContent = false;
      }

      if (child.position === "absolute" || child.position === "fixed") {
        frame.layoutPositioning = "ABSOLUTE";
        frame.x = relativeX;
        frame.y = relativeY;
      }

      applyCornerRadius(frame, child.borderRadius);
      applyStroke(frame, child);
      applyShadow(frame, child.boxShadow);

      parent.appendChild(frame);

      if (parent.layoutMode && parent.layoutMode !== "NONE") {
        if (frame.layoutPositioning !== "ABSOLUTE") {
          frame.layoutAlign = "INHERIT";
        }
      }

      // 1. Build children (Icons/Images) FIRST so they align left
      await buildNode(child, frame, child.x, child.y);

      // 2. Add text SECOND so it aligns right of icons
      if (child.text) {
        await addText(child, frame);
      }
    } catch (err) {
      console.log("Skipped a node due to error:", err, child.tag);
    }
  }
}

async function addText(data, parentFrame) {
  let family = data.fontFamily
    ? data.fontFamily.split(",")[0].replace(/['"]/g, "").trim()
    : "Inter";
  const weight = parseInt(data.fontWeight, 10) || 400;
  const bold = weight >= 600;
  let style = bold ? "Bold" : "Regular";

  if (family.includes("Font Awesome")) {
    if (weight >= 900) style = "Solid";
    else if (weight >= 400) style = "Regular";
    else style = "Light";
  }

  let font = { family, style };

  try {
    await figma.loadFontAsync(font);
  } catch (err) {
    if (family.includes("Font Awesome")) {
      try {
        font = { family: "Font Awesome 5 Free", style: "Solid" };
        await figma.loadFontAsync(font);
      } catch (e1) {
        try {
          font = { family: "Font Awesome 5 Brands", style: "Regular" };
          await figma.loadFontAsync(font);
        } catch (e2) {
          font = { family: "Inter", style: "Regular" };
          await figma.loadFontAsync(font);
        }
      }
    } else {
      console.log(`Missing font ${family}, falling back to Inter`);
      font = { family: "Inter", style: "Regular" };
      await figma.loadFontAsync(font);
    }
  }

  // Clean up CSS3 Alt Text Garbage (Removes the missing character boxes)
  let cleanText = data.text || "";
  if (family.includes("Font Awesome")) {
    cleanText = cleanText
      .split('" / "')[0]
      .split("' / '")[0]
      .replace(/["']/g, "")
      .trim();
  }

  const textNode = figma.createText();
  textNode.fontName = font;
  textNode.characters = cleanText;
  textNode.fontSize = parseFloat(data.fontSize) || 16;
  textNode.fills = parseFill(data.color);

  const alignMap = { center: "CENTER", right: "RIGHT", justify: "JUSTIFY" };
  textNode.textAlignHorizontal = alignMap[data.textAlign] || "LEFT";
  textNode.textAlignVertical = "CENTER";

  if (data.lineHeight && data.lineHeight !== "normal") {
    const lh = parseFloat(data.lineHeight);
    if (!isNaN(lh)) textNode.lineHeight = { value: lh, unit: "PIXELS" };
  } else {
    textNode.lineHeight = { unit: "AUTO" };
  }

  if (parentFrame.layoutMode === "NONE") {
    const pt = parseFloat(data.paddingTop) || 0;
    const pr = parseFloat(data.paddingRight) || 0;
    const pb = parseFloat(data.paddingBottom) || 0;
    const pl = parseFloat(data.paddingLeft) || 0;

    textNode.x = pl;
    textNode.y = pt;

    textNode.textAutoResize = "WIDTH_AND_HEIGHT";
    const naturalWidth = textNode.width;

    textNode.textAutoResize = "HEIGHT";
    const targetWidth = parentFrame.width - pl - pr;
    const finalWidth = Math.max(targetWidth, naturalWidth, 1);

    textNode.resize(finalWidth, textNode.height);
  } else {
    textNode.layoutAlign = "STRETCH";
  }

  parentFrame.appendChild(textNode);
}

function applyAutoLayout(frame, data) {
  frame.layoutMode =
    data.flexDirection === "column" ? "VERTICAL" : "HORIZONTAL";

  const justifyMap = {
    "flex-start": "MIN",
    center: "CENTER",
    "flex-end": "MAX",
    "space-between": "SPACE_BETWEEN",
    "space-around": "SPACE_BETWEEN",
    "space-evenly": "SPACE_BETWEEN",
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

  const gapParts = (data.gap || "0").split(" ").map((g) => parseFloat(g));
  let primaryGap = !isNaN(gapParts[0]) ? gapParts[0] : 0;
  let counterGap =
    gapParts.length > 1 && !isNaN(gapParts[1]) ? gapParts[1] : primaryGap;

  const validChildren = (data.children || []).filter(
    (c) => c && typeof c === "object",
  );
  if (primaryGap === 0 && validChildren.length > 1) {
    const c1 = validChildren[0];
    const c2 = validChildren[1];
    if (c1.x !== undefined && c2.x !== undefined) {
      if (data.flexDirection && data.flexDirection.includes("row")) {
        primaryGap = Math.max(0, c2.x - (c1.x + c1.width));
      } else {
        primaryGap = Math.max(0, c2.y - (c1.y + c1.height));
      }
    }
  } else if (primaryGap === 0 && validChildren.length === 1 && data.text) {
    primaryGap = 8;
  }

  frame.itemSpacing = primaryGap;

  if (data.flexWrap === "wrap") {
    frame.layoutWrap = "WRAP";
    frame.counterAxisSpacing = counterGap;
  }

  const pt = parseFloat(data.paddingTop);
  const pr = parseFloat(data.paddingRight);
  const pb = parseFloat(data.paddingBottom);
  const pl = parseFloat(data.paddingLeft);

  frame.paddingTop = isNaN(pt) ? 0 : pt;
  frame.paddingRight = isNaN(pr) ? 0 : pr;
  frame.paddingBottom = isNaN(pb) ? 0 : pb;
  frame.paddingLeft = isNaN(pl) ? 0 : pl;
}

function applyCornerRadius(frame, borderRadius) {
  const value = parseFloat(borderRadius);
  if (!isNaN(value) && value > 0) {
    frame.cornerRadius = value;
  }
}

function applyStroke(frame, data) {
  if (!data.borderStyle || data.borderStyle === "none") return;

  const fill = parseFill(data.borderColor);
  if (fill.length === 0) return;

  const widths = (data.borderWidth || "0")
    .split(" ")
    .map((w) => parseFloat(w) || 0);
  let top = 0,
    right = 0,
    bottom = 0,
    left = 0;

  if (widths.length === 1) {
    top = right = bottom = left = widths[0];
  } else if (widths.length === 2) {
    top = bottom = widths[0];
    right = left = widths[1];
  } else if (widths.length === 3) {
    top = widths[0];
    right = left = widths[1];
    bottom = widths[2];
  } else if (widths.length >= 4) {
    top = widths[0];
    right = widths[1];
    bottom = widths[2];
    left = widths[3];
  }

  if (top === 0 && right === 0 && bottom === 0 && left === 0) return;

  frame.strokes = fill;

  frame.strokeTopWeight = top;
  frame.strokeRightWeight = right;
  frame.strokeBottomWeight = bottom;
  frame.strokeLeftWeight = left;

  frame.strokeAlign = "INSIDE";
}

function applyShadow(frame, boxShadowString) {
  if (!boxShadowString || boxShadowString === "none") return;

  const match = boxShadowString.match(
    /rgba?\(([^)]+)\)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/,
  );
  if (!match) return;

  const [, colorPart, offsetX, offsetY, blur] = match;
  const parts = colorPart.split(",").map((n) => parseFloat(n.trim()));
  const [r, g, b, a = 1] = parts;

  frame.effects = [
    {
      type: "DROP_SHADOW",
      color: { r: r / 255, g: g / 255, b: b / 255, a },
      offset: { x: parseFloat(offsetX), y: parseFloat(offsetY) },
      radius: parseFloat(blur),
      visible: true,
      blendMode: "NORMAL",
    },
  ];
}

function parseFill(cssColor) {
  if (!cssColor) return [];

  const match = cssColor.match(/rgba?\(([^)]+)\)/);
  if (!match) return [];

  const parts = match[1].split(",").map((n) => parseFloat(n.trim()));
  const [r, g, b, a = 1] = parts;

  if (a === 0) return [];

  return [
    {
      type: "SOLID",
      color: { r: r / 255, g: g / 255, b: b / 255 },
      opacity: a,
    },
  ];
}

function base64ToUint8Array(base64String) {
  const base64 = base64String.split(",")[1];
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
