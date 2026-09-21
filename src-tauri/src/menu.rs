//! The application menu.
//!
//! Until this module existed, Helix set no menu at all, so macOS fell back to
//! Tauri's generic default: an app submenu, a near-empty File, the system Edit
//! items and nothing else. Every command the product has lived in the command
//! palette and in eight web-layer shortcuts, which meant a Mac owner had
//! nowhere to *look* for what the app can do, and no Settings… item under the
//! app menu even though Cmd+, was bound (design/apple-hig-review.md, finding 2;
//! `the-menu-bar.md` › Best practices).
//!
//! How the two halves meet. A predefined item is handled by the operating
//! system and never reaches us — that is what Cut, Copy, Paste, Select All,
//! Hide, Quit, Minimise, Zoom and Enter Full Screen are, so a text field keeps
//! the behaviour a Mac user expects from it. Everything that is Helix's own is
//! a custom item whose id is a *command id from the feature registry*, or a
//! `nav:` route; the handler emits it to the web view as the `menu` event and
//! `src/app/menu.ts` runs it. Two ids are handled here in Rust instead, because
//! they are about the process rather than about the screen: bringing the
//! windows forward, and opening the issue tracker in a browser.
//!
//! Undo and Redo are deliberately NOT the predefined items. A predefined Undo
//! takes Cmd+Z for the focused text field and nothing else, and Helix's undo
//! has to reverse a pipeline move or a field edit as well
//! (design/apple-hig-review.md, finding 3). They are custom items, and
//! `src/app/menu.ts` hands the keystroke back to the focused field when the
//! owner is typing — so a text field still undoes its own typing.
//!
//! Windows. Tauri renders this menu *inside* the window on Windows rather than
//! in a system menu bar. Helix's floor is a 1024px-wide window and the Windows
//! end-to-end suite drives the real app through WebDriver, so turning an
//! in-window menu bar on there is a layout change this pass cannot verify on a
//! Windows machine. The menu is therefore built on every platform but attached
//! on macOS only; `attach` is the one place that decides, and flipping it is a
//! one-line change once someone can look at it at 1024px.

use tauri::menu::{AboutMetadataBuilder, Menu, MenuEvent, MenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Runtime};


/// The event the web view listens for. One event carrying the item id, rather
/// than an event per item, so adding a menu item needs no Rust change on the
/// listening side (`src/app/menu.ts`).
pub const MENU_EVENT: &str = "menu";

/// Where "Report a problem" goes. The repository in Cargo.toml, plus `/issues`.
const ISSUES_URL: &str = "https://github.com/clearpathdigital/helix-crm/issues";

/// The one id this process answers itself instead of forwarding. Bring All to
/// Front needs no id of its own: it is a predefined item, so AppKit does it.
const ID_REPORT_PROBLEM: &str = "report-a-problem";

/// A custom item whose id the web view will recognise.
fn item<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    text: &str,
    accelerator: Option<&str>,
) -> tauri::Result<MenuItem<R>> {
    MenuItem::with_id(app, id, text, true, accelerator)
}

/// Build the whole menu. Ids that are not `nav:` or handled here are command
/// ids from `src/app/registry.ts`, and a typo shows up as a menu item that does
/// nothing — `src/app/menu.ts` logs the miss rather than failing silently.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let package = app.package_info();

    let about = AboutMetadataBuilder::new()
        .name(Some("Helix CRM"))
        .version(Some(package.version.to_string()))
        .copyright(Some("Copyright (c) 2026 ClearPath Digital. AGPL-3.0-only."))
        .build();

    // The app menu. macOS puts the app's own name on it; Settings… is the
    // item the review found missing even though Cmd+, was already bound.
    let settings = item(app, "open-settings", "Settings…", Some("CmdOrCtrl+,"))?;
    let app_menu = SubmenuBuilder::new(app, "Helix CRM")
        .about(Some(about))
        .separator()
        .item(&settings)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    // File. "New contact" is the quick-add dialog on its contact tab, which is
    // what Cmd+N already opened, so it reuses that command rather than adding a
    // second one; "New deal" is the same dialog on its deal tab.
    let new_contact = item(app, "quick-add", "New contact", Some("CmdOrCtrl+N"))?;
    let new_deal = item(app, "new-deal", "New deal", None)?;
    let import = item(app, "import-csv", "Import…", None)?;
    let export = item(app, "export-all", "Export…", None)?;
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&new_contact)
        .item(&new_deal)
        .separator()
        .item(&import)
        .item(&export)
        .separator()
        .close_window()
        .build()?;

    // Edit. Undo and Redo are ours (see the module note); everything below the
    // separator is the system's, so a text field behaves exactly as it should.
    let undo = item(app, "undo", "Undo", Some("CmdOrCtrl+Z"))?;
    let redo = item(app, "redo", "Redo", Some("Shift+CmdOrCtrl+Z"))?;
    let find = item(app, "search", "Find", Some("CmdOrCtrl+K"))?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&undo)
        .item(&redo)
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&find)
        .build()?;

    // View. The eight screens the sidebar lists, in sidebar order, on Cmd+1
    // through Cmd+8 — the arrangement Mail and Notes use, so the numbers mean
    // the same thing they mean everywhere else on the platform.
    let views = [
        ("nav:/", "Today", "CmdOrCtrl+1"),
        ("nav:/contacts", "Contacts", "CmdOrCtrl+2"),
        ("nav:/companies", "Companies", "CmdOrCtrl+3"),
        ("nav:/pipeline", "Pipeline", "CmdOrCtrl+4"),
        ("nav:/tasks", "Tasks", "CmdOrCtrl+5"),
        ("nav:/reports", "Reports", "CmdOrCtrl+6"),
        ("nav:/recurring", "Reminders", "CmdOrCtrl+7"),
        ("nav:/invoices", "Invoices", "CmdOrCtrl+8"),
    ];
    let view_items = views
        .iter()
        .map(|(id, text, accel)| item(app, id, text, Some(*accel)))
        .collect::<tauri::Result<Vec<_>>>()?;
    let toggle_theme = item(app, "toggle-theme", "Toggle theme", None)?;
    // Cmd+R is claimed here, at the menu, so AppKit routes it to the command
    // instead of the web view reloading the whole page.
    let refresh = item(app, "refresh", "Refresh", Some("CmdOrCtrl+R"))?;
    let mut view_menu = SubmenuBuilder::new(app, "View");
    for view_item in &view_items {
        view_menu = view_menu.item(view_item);
    }
    let view_menu = view_menu
        .separator()
        .item(&refresh)
        .item(&toggle_theme)
        .separator()
        .fullscreen()
        .build()?;

    // Window. Minimise and Zoom are the system's; Bring All to Front is a
    // predefined item on macOS and a no-op elsewhere.
    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .bring_all_to_front()
        .build()?;

    let help = item(app, "open-help", "Helix Help", None)?;
    let shortcuts = item(app, "show-shortcuts", "Keyboard shortcuts", None)?;
    let report = item(app, ID_REPORT_PROBLEM, "Report a problem", None)?;
    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&help)
        .item(&shortcuts)
        .separator()
        .item(&report)
        .build()?;

    Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ],
    )
}

/// Handle one menu item. Anything this process does not own is forwarded to the
/// web view, which is where the command registry lives.
pub fn handle<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let id = event.id().as_ref();

    match id {
        ID_REPORT_PROBLEM => {
            use tauri_plugin_opener::OpenerExt;
            if let Err(err) = app.opener().open_url(ISSUES_URL, None::<&str>) {
                tauri_plugin_log::log::warn!("could not open the issue tracker: {err}");
            }
        }
        _ => {
            // Every other id is a command id or a `nav:` route. A failure here
            // means the web view is gone, which is not something a menu click
            // can recover from, so it is logged rather than surfaced.
            if let Err(err) = app.emit(MENU_EVENT, id) {
                tauri_plugin_log::log::warn!("could not deliver the menu event {id}: {err}");
            }
        }
    }
}

/// Attach the menu and its handler.
///
/// macOS only, for the reason in the module note. The build runs on every
/// platform regardless, so a mistake in `build` is a compile error everywhere
/// rather than a surprise on one machine.
pub fn attach<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let menu = build(app)?;

    #[cfg(target_os = "macos")]
    {
        app.set_menu(menu)?;
        let handle = app.clone();
        app.on_menu_event(move |_app, event| handle_on(&handle, event));
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = menu;
    }

    Ok(())
}

/// A thin named wrapper so the closure above stays readable.
#[cfg(target_os = "macos")]
fn handle_on<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    handle(app, event);
}
