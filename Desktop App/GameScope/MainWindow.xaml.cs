using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Input;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Path = System.IO.Path;

namespace GameScope
{
    public partial class MainWindow : Window
    {
        private Dictionary<string, GameInfo> _games = new();

        private readonly string _mainFolder;
        private readonly string _jsonFilePath;

        public MainWindow()
        {
            _mainFolder   = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "data");
            _jsonFilePath = Path.Combine(_mainFolder, "localGames.json");

            InitializeComponent();
            InitializeAsync();
            StateChanged += MainWindow_StateChanged;
        }
        private async void InitializeAsync()
        {
            await webView.EnsureCoreWebView2Async(null);

            webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "gamescope.local",
                Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "src"),
                CoreWebView2HostResourceAccessKind.Allow
            );

            webView.CoreWebView2.Navigate("https://gamescope.local/index.html");
            webView.WebMessageReceived += (s, e) => HandleWebMessage(e);
        }

        // JS -> C# Message router (add a new case if you need more functionality or data manip)
        private async void HandleWebMessage(CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                var message     = JsonSerializer.Deserialize<JsonElement>(e.WebMessageAsJson);
                var messageType = message.GetProperty("type").GetString();

                switch (messageType)
                {
                    case "openBrowser":
                        HandleOpenBrowser(message);
                        await SendMessageToWebView(new { type = "browserOpened", success = true });
                        break;

                    case "loadLocal":
                        await LoadLocalGames();
                        break;

                    case "addLocalGame":
                        await AddLocalGame(message);
                        break;

                    case "launchGame":
                        HandleLaunchGame(message);
                        break;
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[HandleWebMessage] {ex.Message}");
            }
        }

        // Handlers
        private static void HandleOpenBrowser(JsonElement message)
        {
            var url = message.GetProperty("url").GetString();
            LaunchProcess(url!, "");
        }

        private void HandleLaunchGame(JsonElement message)
        {
            var id = message.GetProperty("id").GetString();
            if (id == null || !_games.TryGetValue(id, out var game)) return;
            var (exe, args) = ParseCommandLine(game.ExecPath);
            LaunchProcess(exe, args);
        }
        private async Task LoadLocalGames()
        {
            EnsureJsonFile();

            try
            {
                var json = File.ReadAllText(_jsonFilePath);
                _games = JsonSerializer.Deserialize<Dictionary<string, GameInfo>>(json,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new();

                var gameList = _games.Select(kvp => new
                {
                    id             = kvp.Key,
                    title          = kvp.Key,
                    executablePath = kvp.Value.ExecPath,
                    coverImage     = kvp.Value.IconPath,
                    launchArgs     = kvp.Value.LaunchArgs,
                    dateAdded      = kvp.Value.DateAdded,
                    lastPlayed     = kvp.Value.LastPlayed,
                    playTimeMinutes = kvp.Value.PlayTimeMinutes,
                    source         = "local"
                }).ToList();

                await SendMessageToWebView(new { type = "localGamesLoaded", data = gameList });
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[LoadLocalGames] {ex.Message}");
                await SendMessageToWebView(new { type = "localGamesLoaded", data = new object[0] });
            }
        }
        private async Task AddLocalGame(JsonElement message)
        {
            try
            {
                var title     = message.GetProperty("title").GetString() ?? "Unknown";
                var execPath  = message.GetProperty("executablePath").GetString() ?? "";
                var iconPath  = message.GetProperty("coverImage").GetString() ?? "";
                var launchArgs = message.TryGetProperty("launchArgs", out var la) ? la.GetString() ?? "" : "";

                var id = "local_" + Guid.NewGuid().ToString("N");
                var game = new GameInfo
                {
                    Title          = title,
                    ExecPath       = execPath,
                    IconPath       = iconPath,
                    LaunchArgs     = launchArgs,
                    DateAdded      = DateTime.UtcNow.ToString("o"),
                    LastPlayed     = null,
                    PlayTimeMinutes = 0
                };

                _games[id] = game;
                PersistGames();

                await SendMessageToWebView(new
                {
                    type    = "localGameAdded",
                    success = true,
                    game    = new
                    {
                        id,
                        title          = game.Title,
                        executablePath = game.ExecPath,
                        coverImage     = game.IconPath,
                        launchArgs     = game.LaunchArgs,
                        dateAdded      = game.DateAdded,
                        lastPlayed     = game.LastPlayed,
                        playTimeMinutes = game.PlayTimeMinutes,
                        source         = "local"
                    }
                });
            }
            catch (Exception ex)
            {
                await SendMessageToWebView(new { type = "localGameAdded", success = false, error = ex.Message });
            }
        }
        private void PersistGames()
        {
            try
            {
                EnsureJsonFile();
                var json = JsonSerializer.Serialize(_games, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(_jsonFilePath, json);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[PersistGames] {ex.Message}");
            }
        }
        private void EnsureJsonFile()
        {
            Directory.CreateDirectory(_mainFolder);
            if (!File.Exists(_jsonFilePath))
                File.WriteAllText(_jsonFilePath, "{}");
        }
        private static void LaunchProcess(string path, string arguments)
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName       = path,
                    Arguments      = arguments,
                    UseShellExecute = true
                });
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Failed to launch: {ex.Message}");
            }
        }

        private static (string ExePath, string Arguments) ParseCommandLine(string fullCommand)
        {
            var match = Regex.Match(fullCommand, "^\"([^\"]+)\"\\s*(.*)");
            return match.Success
                ? (match.Groups[1].Value, match.Groups[2].Value)
                : (fullCommand, "");
        }

        // C# -> JS bridge
        private async Task SendMessageToWebView(object payload)
        {
            var json = JsonSerializer.Serialize(payload);
            await webView.CoreWebView2.ExecuteScriptAsync(
                $"window.dispatchEvent(new CustomEvent('hostMessage', {{ detail: {json} }}));"
            );
        }

        // Title bar settings (the styles are in the app.xaml script don't forget)
        private void TitleBar_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            if (e.ClickCount == 2) ToggleMaximize();
            else DragMove();
        }

        private void BtnMinimize_Click(object sender, RoutedEventArgs e)
            => WindowState = WindowState.Minimized;

        private void BtnMaximize_Click(object sender, RoutedEventArgs e)
            => ToggleMaximize();

        private void BtnClose_Click(object sender, RoutedEventArgs e)
            => Close();

        private void ToggleMaximize()
            => WindowState = WindowState == WindowState.Maximized
                ? WindowState.Normal
                : WindowState.Maximized;

        private void MainWindow_StateChanged(object? sender, EventArgs e)
        {
            if (WindowState == WindowState.Maximized)
            {
                var screen = System.Windows.SystemParameters.WorkArea;
                MaxWidth  = screen.Width;
                MaxHeight = screen.Height;
                MaximizeIcon.Text = "\uE923";
            }
            else
            {
                MaxWidth  = double.PositiveInfinity;
                MaxHeight = double.PositiveInfinity;
                MaximizeIcon.Text = "\uE922";
            }
        }
    }

    public class GameInfo
    {
        public string Title           { get; set; } = "";
        public string ExecPath        { get; set; } = "";
        public string IconPath        { get; set; } = "";
        public string LaunchArgs      { get; set; } = "";
        public string DateAdded       { get; set; } = "";
        public string? LastPlayed     { get; set; }
        public int    PlayTimeMinutes { get; set; }
    }
}