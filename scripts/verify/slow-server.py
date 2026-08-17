# -*- coding: utf-8 -*-
"""慢速静态服务器 —— 给开屏登录回归测试用（scripts/verify/splash-login-test.js）。

要复现的 bug 只在「玩家在 boot 跑完之前点开屏按钮」时出现，而本地 localhost
太快：页面 load 事件一到，boot 早就跑完了，测试永远落在另一条路径上。

boot() 的 await 卡在 data/*.json 上，所以这里只给这些请求加延迟 —— 页面本身
正常加载（load 事件照常触发、测试脚本照常注入），但 window.__splashReady
在延迟结束前一直是 false，正是手机弱网时的真实形态。

用法: python scripts/verify/slow-server.py <端口> [延迟秒数]
"""
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

DELAY = float(sys.argv[2]) if len(sys.argv) > 2 else 6.0


class SlowHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        if '/data/' in self.path and self.path.endswith('.json'):
            time.sleep(DELAY)
        return SimpleHTTPRequestHandler.send_head(self)

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8142
    ThreadingHTTPServer(('127.0.0.1', port), SlowHandler).serve_forever()
