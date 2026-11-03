# Capture the Simple Agent window (DPI-safe).
#
# The window is 1280x860 logical at 150% scaling, so a PrintWindow into a
# logical-sized bitmap crops 2/3 of it. Render at physical size instead, then
# downscale for viewing.
param(
  [string]$Out = "D:\Codes\Simple-Agent\.tmp\shot.png",
  [int]$ScrollNotches = 0,
  [int]$Scale = 1.5
)

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class UiCap {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT p);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}
"@

$p = $null
for ($i = 0; $i -lt 24; $i++) {
  $p = Get-Process -Name 'simple-agent' -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($p) { break }
  Start-Sleep -Milliseconds 500
}
if (-not $p) { Write-Output 'NO_WINDOW'; exit 1 }

$h = $p.MainWindowHandle
Write-Output "window: '$($p.MainWindowTitle)' pid=$($p.Id) hwnd=$h"
[UiCap]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 500

if ($ScrollNotches -ne 0) {
  $pt = New-Object UiCap+POINT
  [UiCap]::ClientToScreen($h, [ref]$pt) | Out-Null
  [UiCap]::SetCursorPos(($pt.X + 640), ($pt.Y + 420)) | Out-Null
  Start-Sleep -Milliseconds 250
  for ($i = 0; $i -lt [Math]::Abs($ScrollNotches); $i++) {
    $delta = if ($ScrollNotches -gt 0) { -120 } else { 120 }
    [UiCap]::mouse_event(0x0800, 0, 0, $delta, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 110
  }
  Start-Sleep -Milliseconds 700
}

$r = New-Object UiCap+RECT
[UiCap]::GetWindowRect($h, [ref]$r) | Out-Null
$lw = $r.Right - $r.Left
$lh = $r.Bottom - $r.Top
$bmp = New-Object System.Drawing.Bitmap ([int]($lw * $Scale)), ([int]($lh * $Scale))
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = [UiCap]::PrintWindow($h, $hdc, 2)
$g.ReleaseHdc($hdc)
$g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "printed=$ok size=$([int]($lw*$Scale))x$([int]($lh*$Scale)) -> $Out"
