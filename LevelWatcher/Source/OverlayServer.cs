using System;
using System.IO;
using System.Net;
using System.Text;

namespace Celeste.Mod.LevelWatcher;

/// <summary>
/// 把覆盖层（CCTOverlay.* / Timing.js）用 http 发出去。
///
/// 为什么需要：OBS 的浏览器源底层是 CEF，加载 file:// 页面时会**禁掉页面里的
/// fetch / XMLHttpRequest**（Chrome 放行，CEF 不放行）。于是覆盖层在浏览器里
/// 一切正常，一放进 OBS 就永远停在「当前状态：加载中」。
///
/// 不绕限制，改走 http：页面和接口同一个源，OBS 里填
/// http://localhost:32271/overlay/ 即可。
///
/// 文件仍然读用户原来那份（Celeste/ConsistencyTracker/external-tools/ExternalOverlay），
/// 不复制、不搬家 —— 更新覆盖层照旧覆盖那 4 个文件。
/// </summary>
internal static class OverlayServer {
    public const string Prefix = "/overlay/";
    private const string IndexFile = "CCTOverlay.html";

    /// <summary>覆盖层所在目录（游戏根目录下的 CCT 目录）。</summary>
    public static string Root => Path.GetFullPath(Path.Combine(
        AppDomain.CurrentDomain.BaseDirectory,
        "ConsistencyTracker", "external-tools", "ExternalOverlay"));

    /// <summary>
    /// 把 URL 里的相对路径解析成磁盘路径。
    /// 越界（../ 之类）返回 null —— 只允许发 Root 里的文件。
    /// </summary>
    public static string Resolve(string root, string urlRelative) {
        string rel = Uri.UnescapeDataString(urlRelative ?? "")
                        .Replace('/', Path.DirectorySeparatorChar)
                        .TrimStart(Path.DirectorySeparatorChar);
        if (rel.Length == 0) rel = IndexFile;

        string fullRoot = Path.GetFullPath(root);
        string full;
        try {
            full = Path.GetFullPath(Path.Combine(fullRoot, rel));
        } catch {
            return null;   // 非法字符
        }

        // ⚠️ 必须带结尾分隔符再比：否则 "...\ExternalOverlay2" 会误判成在根目录里
        string guard = fullRoot.EndsWith(Path.DirectorySeparatorChar.ToString())
            ? fullRoot
            : fullRoot + Path.DirectorySeparatorChar;
        return full.StartsWith(guard, StringComparison.OrdinalIgnoreCase) ? full : null;
    }

    public static string ContentTypeOf(string path) {
        switch (Path.GetExtension(path).ToLowerInvariant()) {
            case ".html":  return "text/html; charset=utf-8";
            case ".js":    return "application/javascript; charset=utf-8";
            case ".css":   return "text/css; charset=utf-8";
            case ".json":  return "application/json; charset=utf-8";
            case ".png":   return "image/png";
            case ".jpg":
            case ".jpeg":  return "image/jpeg";
            case ".gif":   return "image/gif";
            case ".svg":   return "image/svg+xml";
            case ".ico":   return "image/x-icon";
            case ".woff":  return "font/woff";
            case ".woff2": return "font/woff2";
            case ".ttf":   return "font/ttf";
            default:       return "application/octet-stream";
        }
    }

    /// <summary>
    /// 处理 /overlay/xxx 请求。返回 true 表示已处理（调用方不要再写 JSON）。
    /// </summary>
    public static bool TryHandle(HttpListenerContext context, string urlPath) {
        if (urlPath == null || !urlPath.StartsWith(Prefix, StringComparison.OrdinalIgnoreCase)) {
            return false;
        }

        var response = context.Response;
        try {
            string root = Root;
            string full = Resolve(root, urlPath.Substring(Prefix.Length));

            if (full == null) {
                WritePlain(response, 403, "forbidden");
                return true;
            }
            if (!File.Exists(full)) {
                WritePlain(response, 404,
                    "找不到 " + urlPath + "\n\n覆盖层应该放在：\n" + root +
                    "\n\n需要这 4 个文件：CCTOverlay.html / CCTOverlay.js / CCTOverlay.css / Timing.js");
                return true;
            }

            byte[] bytes = File.ReadAllBytes(full);
            response.ContentType = ContentTypeOf(full);
            response.ContentLength64 = bytes.Length;
            response.OutputStream.Write(bytes, 0, bytes.Length);
            response.Close();
        } catch (Exception ex) {
            try { WritePlain(response, 500, "error: " + ex.Message); } catch { }
        }
        return true;
    }

    public static void WritePlain(HttpListenerResponse response, int status, string text) {
        byte[] bytes = Encoding.UTF8.GetBytes(text);
        response.StatusCode = status;
        response.ContentType = "text/plain; charset=utf-8";
        response.ContentLength64 = bytes.Length;
        response.OutputStream.Write(bytes, 0, bytes.Length);
        response.Close();
    }
}
