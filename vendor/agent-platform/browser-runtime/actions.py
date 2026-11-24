"""Trusted browser-use CLI script. Inputs are data; no model-generated source is executed."""
import json
import os
import time
from browser_harness import helpers as h


def snapshot():
    info = h.page_info()
    if "dialog" in info:
        raise RuntimeError("网页弹出对话框，需要用户处理。")
    nodes = h.cdp("Accessibility.getFullAXTree").get("nodes", [])
    elements = []
    for node in nodes:
        role = node.get("role", {}).get("value", "")
        name = node.get("name", {}).get("value", "")
        if role in {"link", "button", "textbox", "searchbox", "combobox", "checkbox"} and name:
            elements.append({"id": node.get("backendDOMNodeId"), "role": role, "name": name[:160]})
    text = h.js("document.body ? document.body.innerText.slice(0,18000) : ''")
    links = h.js("JSON.stringify(Array.from(document.links).filter(a=>a.innerText.trim()).slice(0,60).map(a=>({title:a.innerText.trim().slice(0,160),url:a.href})))")
    return {"url": info.get("url", ""), "title": info.get("title", ""), "text": text,
            "links": json.loads(links), "elements": elements[:100]}


def run(request):
    action, params = request["action"], request["params"]
    h.cdp("Browser.setDownloadBehavior", behavior="deny")
    if action == "open":
        if request.get("first"):
            tab = h.new_tab(params["url"])
            h.activate_tab(tab)  # This is a dedicated task browser, explicitly requested by the user.
        else:
            h.goto_url(params["url"])
        h.wait_for_load(timeout=12)
    elif action in {"click", "type"}:
        node_id = int(params["element"])
        h.cdp("DOM.scrollIntoViewIfNeeded", backendNodeId=node_id)
        box = h.cdp("DOM.getBoxModel", backendNodeId=node_id)["model"]["content"]
        h.click_at_xy(sum(box[0::2])/4, sum(box[1::2])/4)
        if action == "type":
            h.type_text(params["text"])
        h.wait_for_load(timeout=8)
    elif action == "scroll":
        h.press_key("PageDown" if params.get("direction", "down") == "down" else "PageUp")
    elif action != "read":
        raise ValueError("Unsupported action")
    # Navigation can finish before a JS site renders its content.
    if action in {"open", "scroll"}:
        previous = ""
        for _ in range(16):
            time.sleep(0.5)
            current = h.js("document.body ? document.body.innerText.slice(0,18000) : ''")
            if params.get("waitForSearch"):
                if h.js("!!document.querySelector('#b_results .b_algo')"):
                    break
            elif len(current) > 100 and current == previous:
                break
            previous = current
    return snapshot()


try:
    result = run(json.loads(os.environ["AGENT_BROWSER_REQUEST"]))
except Exception as exc:
    result = {"error": str(exc)[:500]}
print("AGENT_BROWSER_RESULT:" + json.dumps(result, ensure_ascii=False))
