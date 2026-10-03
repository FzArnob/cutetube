; CuteTube installer (Inno Setup 6). Built by packaging\build.ps1, which passes AppVersion and SourceDir.
; Installs for the current user by default (no administrator prompt); "Install for all users" is offered too.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\build\app\CuteTube"
#endif

#ifndef TermsVersion
  #define TermsVersion "1"
#endif
#ifndef RepoUrl
  #define RepoUrl "https://github.com/"
#endif

[Setup]
AppId={{6C7E2A51-3B0F-4C59-9B4E-6F2C1D8A7E30}
AppName=CuteTube
AppVersion={#AppVersion}
AppVerName=CuteTube {#AppVersion}
AppPublisher=CuteTube
AppPublisherURL={#RepoUrl}
AppSupportURL={#RepoUrl}/issues
AppUpdatesURL={#RepoUrl}/releases
VersionInfoVersion={#AppVersion}
VersionInfoProductName=CuteTube
VersionInfoDescription=CuteTube Setup
DefaultDirName={autopf}\CuteTube
DefaultGroupName=CuteTube
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
LicenseFile=..\build\agreement.txt
OutputBaseFilename=CuteTube-Setup
SetupIconFile=..\app\assets\cutetube.ico
UninstallDisplayIcon={app}\CuteTube.exe
UninstallDisplayName=CuteTube
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\legal\TERMS.md"; DestDir: "{app}\legal"; Flags: ignoreversion
Source: "..\legal\PRIVACY.md"; DestDir: "{app}\legal"; Flags: ignoreversion
Source: "..\legal\THIRD-PARTY-NOTICES.md"; DestDir: "{app}\legal"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}\legal"; Flags: ignoreversion

[Icons]
Name: "{group}\CuteTube"; Filename: "{app}\CuteTube.exe"; AppUserModelID: "Cutetube.App"
Name: "{autodesktop}\CuteTube"; Filename: "{app}\CuteTube.exe"; Tasks: desktopicon; AppUserModelID: "Cutetube.App"

[Run]
Filename: "{app}\CuteTube.exe"; Description: "{cm:LaunchProgram,CuteTube}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Files the app writes next to itself (none today); user data in %LOCALAPPDATA%\CuteTube is handled below.
Type: filesandordirs; Name: "{app}\_internal\__pycache__"

[Code]
const
  WebView2Key = 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  WebView2UserKey = 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

function HasWebView2: Boolean;
var
  V: String;
begin
  Result := (RegQueryStringValue(HKLM, WebView2Key, 'pv', V) and (V <> '') and (V <> '0.0.0.0')) or
            (RegQueryStringValue(HKCU, WebView2UserKey, 'pv', V) and (V <> '') and (V <> '0.0.0.0'));
end;

function InitializeSetup: Boolean;
var
  Code: Integer;
begin
  Result := True;
  // Built into Windows 11 and current Windows 10; older Windows 10 needs Microsoft's runtime.
  if not HasWebView2 then
    if MsgBox('CuteTube needs the Microsoft Edge WebView2 Runtime, which is not installed on this PC.' + #13#10#13#10 +
              'Open Microsoft''s download page now? Install it, then run this setup again.',
              mbConfirmation, MB_YESNO) = IDYES then
    begin
      ShellExec('open', 'https://developer.microsoft.com/microsoft-edge/webview2/#download', '', '', SW_SHOWNORMAL, ewNoWait, Code);
      Result := False;
    end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Data: String;
begin
  // The user accepted the Terms and Privacy Policy on the license page: the app won't ask again.
  if CurStep = ssPostInstall then
  begin
    Data := ExpandConstant('{localappdata}\CuteTube');
    ForceDirectories(Data);
    SaveStringToFile(Data + '\terms-accepted.txt', '{#TermsVersion}', False);
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Data: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    Data := ExpandConstant('{localappdata}\CuteTube');
    if DirExists(Data) and not UninstallSilent then
      if MsgBox('Also delete your CuteTube data (settings, download history and the sign-ins for YouTube, Instagram, Facebook and TikTok)?' + #13#10#13#10 +
                'Your downloaded videos and photos are not affected.', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(Data, True, True, True);
  end;
end;
