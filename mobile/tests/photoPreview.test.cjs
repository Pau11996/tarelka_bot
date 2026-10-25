const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");

function setup() {
  let open = false;
  let dismissed = 0;
  const element = (type, props) => ({ type, props });
  const code = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../src/components/PhotoPreview.tsx"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
  ).outputText;
  const context = { exports: {}, require: (name) => {
    if (name === "react") return { useState: () => [open, (next) => { open = next; }] };
    if (name === "react/jsx-runtime") return { jsx: element, jsxs: element, Fragment: "Fragment" };
    if (name === "react-native") return {
      Modal: "Modal", Pressable: "Pressable", StatusBar: "StatusBar", Text: "Text", View: "View",
      Keyboard: { dismiss: () => dismissed++ }, StyleSheet: { create: (value) => value },
    };
    if (name === "react-native-safe-area-context") return { SafeAreaView: "SafeAreaView" };
    if (name === "./Brand") return { Icon: "Icon" };
    if (name === "./ProtectedImage") return { ProtectedImage: "ProtectedImage" };
    throw new Error(name);
  }};
  vm.runInNewContext(code, context);
  const props = { uri: "https://api.example/v1/media/photo", previewUri: "file:///cache/photo.jpg", style: { width: 96, height: 96 } };
  return { render: () => context.exports.PhotoPreview(props), dismissed: () => dismissed, props };
}

function nodes(root) {
  if (!root || typeof root !== "object") return [];
  const children = root.props?.children;
  return [root, ...(Array.isArray(children) ? children : [children]).flatMap(nodes)];
}

test("sent photo opens full screen without opening the parent entry card", () => {
  const app = setup();
  let stopped = 0;
  const thumbnail = nodes(app.render()).find((node) => node.props?.accessibilityLabel === "Увеличить фото еды");
  assert.ok(thumbnail);
  assert.equal(nodes(app.render()).some((node) => node.type === "Modal"), false);
  thumbnail.props.onPress({ stopPropagation: () => stopped++ });
  assert.equal(stopped, 1);
  assert.equal(app.dismissed(), 1);
  const modal = nodes(app.render()).find((node) => node.type === "Modal");
  assert.ok(modal);
  const image = nodes(modal).find((node) => node.type === "ProtectedImage");
  assert.equal(image.props.uri, app.props.uri);
  assert.equal(image.props.previewUri, app.props.previewUri);
  assert.equal(image.props.style.resizeMode, "contain");
  const close = nodes(modal).find((node) => node.props?.accessibilityLabel === "Закрыть фото");
  close.props.onPress({ stopPropagation: () => stopped++ });
  assert.equal(stopped, 2);
  assert.equal(nodes(app.render()).some((node) => node.type === "Modal"), false);
});

test("Android back closes the photo viewer", () => {
  const app = setup();
  nodes(app.render()).find((node) => node.props?.accessibilityLabel === "Увеличить фото еды").props.onPress({ stopPropagation() {} });
  nodes(app.render()).find((node) => node.type === "Modal").props.onRequestClose();
  assert.equal(nodes(app.render()).some((node) => node.type === "Modal"), false);
});
