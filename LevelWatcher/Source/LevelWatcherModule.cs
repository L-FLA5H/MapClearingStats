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

    private void ProcessRequest(HttpListenerContext context) {
        var response = context.Response;
        var scene = Engine.Scene;
        string sceneType = scene?.GetType().FullName ?? "null";

        response.AddHeader("Access-Control-Allow-Origin", "*");

        string json = "{\"sceneType\":\"" + sceneType + "\"}";
        byte[] buffer = Encoding.UTF8.GetBytes(json);
        response.ContentType = "application/json; charset=utf-8";
        response.ContentLength64 = buffer.Length;
        response.OutputStream.Write(buffer, 0, buffer.Length);
        response.Close();
    }
}