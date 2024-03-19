import { createElementVNode as _createElementVNode, toDisplayString as _toDisplayString, openBlock as _openBlock, createElementBlock as _createElementBlock } from "vue"

const _hoisted_1 = /*#__PURE__*/_createElementVNode("h1", null, "Frappe Vue SSR", -1 /* HOISTED */)

export function render(_ctx, _cache) {
  return (_openBlock(), _createElementBlock("template", null, [
    _createElementVNode("div", null, [
      _hoisted_1,
      _createElementVNode("p", null, _toDisplayString(_ctx.message), 1 /* TEXT */)
    ])
  ]))
}