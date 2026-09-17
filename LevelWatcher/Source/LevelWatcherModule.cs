using System;
using System.Net;
using System.Text;
using System.Threading;
using Celeste;
using Celeste.Mod;
using Monocle;

namespace Celeste.Mod.LevelWatcher;

public class LevelWatcherModule : EverestModule {
    public static LevelWatcherModule Instance { get; private set; }

    public override Type SettingsType => typeof(LevelWatcherModuleSettings);
    public static LevelWatcherModuleSettings Settings => (LevelWatcherModuleSettings) Instance._Settings;

    public override Type SessionType => typeof(LevelWatcherModuleSession);
    public static LevelWatcherModuleSession Session => (LevelWatcherModuleSession) Instance._Session;

    public override Type SaveDataType => typeof(LevelWatcherModuleSaveData);
    public static LevelWatcherModuleSaveData SaveData => (LevelWatcherModuleSaveData) Instance._SaveData;

    private HttpListener httpListener;
    private Thread httpThread;

    public LevelWatcherModule() {
        Instance = this;
        Logger.SetLogLevel(nameof(LevelWatcherModule), LogLevel.Info);
    }

    public override void Load() {
        StartHttpServer();
        Logger.Log(LogLevel.Info, "LevelWatcher", "LevelWatcher loaded on http://localhost:32271/");
    }

    public override void Unload() {
        StopHttpServer();
    }

    private void StartHttpServer() {
        httpListener = new HttpListener();
        httpListener.Prefixes.Add("http://localhost:32271/");
        httpListener.Start();
        httpThread = new Thread(HttpLoop) { IsBackground = true };
        httpThread.Start();
    }

    private void StopHttpServer() {
        if (httpListener != null && httpListener.IsListening) {
            httpListener.Stop();
            httpListener.Close();
        }
    }

    private void HttpLoop() {
        while (httpListener.IsListening) {
            try {
                var context = httpListener.GetContext();
                ProcessRequest(context);
            } catch (HttpListenerException) { break; }
            catch (Exception ex) {
                Logger.Log(LogLevel.Error, "LevelWatcher", $"HTTP error: {ex.Message}");
            }
        }
    }

    // 游戏是否处于「暂停 / 冻结」状态。
    //
    // 小闪反馈：「暂停游戏不会使计时也暂停」。
    // 覆盖层原来只能靠「不在关卡内」来判断暂停，但游戏内的暂停菜单
    // **不会改变场景类型**（还是 Celeste.Level），所以检测不到。
    //
    // ⚠️ 这里用反射而不是直接写 scene.Paused：
    //    Celeste 里这几个成员是属性还是字段、定义在 Scene 还是 Level，
    //    我在本机没法编译验证（沙箱跑不了 dotnet build），
    //    反射能同时兼容「属性 / 字段」「本类 / 基类」，避免猜错编译不过。
    //    找不到就返回 false（退化成原来的行为，不会更糟）。
    private static bool IsScenePaused(Scene scene) {
        if (scene == null) return false;
        try {
            var t = scene.GetType();
            var p = t.GetProperty("FrozenOrPaused") ?? t.GetProperty("Paused");
            if (p != null) return (bool) p.GetValue(scene, null);
            var f = t.GetField("Paused");
            if (f != null) return (bool) f.GetValue(scene);
        } catch { }
        return false;
    }

    private void ProcessRequest(HttpListenerContext context) {
        var response = context.Response;
        var scene = Engine.Scene;
        string sceneType = scene?.GetType().FullName ?? "null";
        bool paused = IsScenePaused(scene);

        response.AddHeader("Access-Control-Allow-Origin", "*");

        string json = "{\"sceneType\":\"" + sceneType + "\",\"paused\":" + (paused ? "true" : "false") + "}";
        byte[] buffer = Encoding.UTF8.GetBytes(json);
        response.ContentType = "application/json; charset=utf-8";
        response.ContentLength64 = buffer.Length;
        response.OutputStream.Write(buffer, 0, buffer.Length);
        response.Close();
    }
}