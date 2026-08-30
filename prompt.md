Now, lets move to next issue,

Fix Chat Responsive Layout + Long-Press Reaction Picker

I need you to thoroughly fix the responsive layout and long-press reaction system in my chat web app.

I have provided screenshots showing the current behavior on both mobile and desktop.

The goal is NOT to redesign the application.

The goal is to make the existing chat UI behave correctly at every viewport size, especially when the user long-presses/right-clicks a message and the reaction picker appears.

⸻

1. Main problem

The current implementation has a combination of responsive layout and reaction-picker positioning problems.

On mobile, the chat UI sometimes appears zoomed or incorrectly sized, the header becomes misaligned, and there can be a large unused area on the right side.

I strongly suspect that the long-press reaction picker is contributing to this because it can extend outside the viewport and cause horizontal overflow or force the layout to become wider than the device.

The same fundamental problem appears to exist on desktop as well.

Therefore, treat the reaction picker and viewport overflow as a major part of this fix.

⸻

2. Critical requirement: reaction picker MUST NEVER leave the viewport

When a user long-presses a message, the reaction picker appears.

The picker must ALWAYS remain completely inside the visible viewport.

This applies to:

* iPhone
* Android
* tablet
* desktop
* narrow desktop windows
* messages near the left edge
* messages near the right edge
* messages near the top
* messages near the bottom
* very long messages
* short messages
* sent messages
* received messages

Example

If the message is near the right edge:

                         MESSAGE →
                    ┌───────────────┐
                    │     Hello     │
                    └───────────────┘
                             
                         ❌ reaction picker
                              extends →
                              outside screen

This must instead become:

                         MESSAGE →
                    ┌───────────────┐
                    │     Hello     │
                    └───────────────┘
                 ┌───────────────────┐
                 │ ❤️ 👍 😂 😮 😢 🙏 │
                 └───────────────────┘

The picker should intelligently reposition itself.

If there isn’t enough space on the right, move it left.

If there isn’t enough space on the left, move it right.

If there isn’t enough space above the message, position it below.

If there isn’t enough space below the message, position it above.

The picker must be clamped within the viewport with a small safe margin.

For example:

viewport width = W
picker left >= safeMargin
picker right <= W - safeMargin

Never allow:

picker.left < 0

or:

picker.right > viewportWidth

⸻

3. Do NOT let the reaction picker affect document width

This is extremely important.

Opening the reaction picker must NOT:

* increase the width of the page
* increase the width of the chat container
* create horizontal scrolling
* push the header
* push the messages
* push the composer
* change the width of the chat panel
* create a large blank area on the right
* cause Safari to zoom the page
* cause the viewport to become wider than the device

The picker should behave as an overlay.

Prefer an appropriate positioning strategy such as:

position: fixed;

or another robust overlay approach if the existing architecture requires it.

Do NOT simply position the picker using:

left: 100%;

or similar logic without checking viewport boundaries.

Do not assume the message itself has enough room beside it.

⸻

4. Reaction picker positioning algorithm

Inspect the existing reaction-picker implementation.

If necessary, rewrite its positioning logic so that it:

1. Detects the message’s bounding rectangle.
2. Detects the reaction picker’s dimensions.
3. Detects the viewport dimensions.
4. Calculates the ideal position.
5. Checks whether that position would overflow.
6. Automatically shifts the picker back inside the viewport.
7. Chooses above/below positioning when necessary.
8. Recalculates on resize.
9. Recalculates when the viewport changes.
10. Works correctly when the chat is scrolled.

Use modern browser APIs where appropriate, such as:

getBoundingClientRect()

and viewport dimensions.

Do not hard-code positions for specific phones.

⸻

5. Mobile Safari / iPhone requirements

The screenshots show the issue occurring on iPhone Safari.

Make sure the application has a correct viewport configuration:

<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">

Check whether the existing viewport meta tag is missing or incorrect.

Also investigate:

* 100vw
* 100vh
* 100dvh
* 100svh
* 100lvh
* min-width
* fixed widths
* flex children that don’t shrink
* grid children that don’t shrink
* CSS transforms
* absolute positioning
* fixed positioning
* body width
* html width
* overflow
* padding/borders
* safe-area insets
* Safari dynamic browser UI

Use 100dvh where appropriate for the actual chat viewport.

Do not blindly replace everything with 100vw or 100vh.

⸻

6. No horizontal overflow anywhere

The entire application must satisfy:

document.scrollWidth <= viewport width

under normal usage.

This must remain true even when:

* reaction picker is open
* long-press menu is open
* message is extremely long
* user sends a very long URL
* message contains long unbroken text
* keyboard is open
* browser window is narrow
* chat is scrolled
* a message is near the edge of the viewport

Inspect all major containers.

Pay particular attention to:

width
min-width
max-width
100vw
position
left
right
transform
margin
padding
flex
grid
overflow

Use:

box-sizing: border-box;

where appropriate.

For flex/grid children, investigate whether:

min-width: 0;

is required.

Do not use overflow-x: hidden as the only solution.

If you use it, first identify and fix the actual element causing the overflow.

⸻

7. Chat container

The chat itself should always fit the available viewport.

On mobile:

┌──────────────────────────────┐
│          HEADER              │
├──────────────────────────────┤
│                              │
│          MESSAGES            │
│                              │
│                              │
├──────────────────────────────┤
│          COMPOSER            │
└──────────────────────────────┘

There should NEVER be:

┌─────────────────────┬───────────────┐
│     CHAT            │ EMPTY AREA    │
│                     │               │
│                     │               │
└─────────────────────┴───────────────┘

The screenshot currently shows behavior resembling this.

Find the actual reason for that width mismatch.

Do not just hide the right side.

⸻

8. Header

The header must remain completely inside the viewport.

Check:

* title/name positioning
* online/offline indicator
* three-dot menu
* padding
* fixed/absolute positioning
* width
* min-width
* overflow

The three-dot menu must never be pushed outside the screen.

The header width must follow the chat viewport.

⸻

9. Message bubbles

Message bubbles must be responsive.

They must:

* wrap naturally
* never force the page wider
* handle long text
* handle long URLs
* handle images/videos later
* respect the existing max-width
* remain inside the chat container

Inspect rules such as:

white-space
word-break
overflow-wrap
max-width
width
min-width

Do not unnecessarily change the visual appearance of the bubbles.

⸻

10. Long press behavior

Inspect the current long-press implementation.

The long press should:

1. Detect the message being pressed.
2. Open the reaction picker.
3. Position it relative to that message.
4. Keep the picker inside the viewport.
5. Not change the layout dimensions.
6. Not create horizontal scrolling.
7. Not cause the entire page to zoom.
8. Work on touch devices.
9. Work with mouse/right-click where applicable.
10. Close correctly when the user taps/clicks elsewhere.

Also check whether the current implementation is accidentally triggering native browser behavior such as text selection.

If appropriate, prevent unwanted text selection during the long-press interaction, but do NOT disable normal text selection throughout the entire chat unnecessarily.

⸻

11. Reaction picker dimensions

Do not assume the reaction picker has infinite horizontal space.

For example, if the picker contains:

❤️ 👍 😂 😮 😢 🙏

it should adapt to narrow screens.

On very narrow screens, make sure:

picker width + margins <= viewport width

If necessary, allow the picker to shrink or adjust its spacing.

The picker itself must never cause horizontal overflow.

⸻

12. Desktop behavior

This is NOT just a mobile fix.

The same positioning system must work on desktop.

Test scenarios such as:

Message on far right

┌─────────────────────────────────────────────┐
│                                      MESSAGE│
│                                      ┌─────┐│
│                                      └─────┘│
│                               REACTIONS ←───│
└─────────────────────────────────────────────┘

The picker must remain inside the desktop viewport.

Message on far left

The picker must not extend beyond the left edge.

Message near the bottom

The picker must move above the message if there isn’t enough space below.

Message near the top

The picker must move below the message if necessary.

⸻

13. Do not solve this with arbitrary offsets

Avoid fragile fixes like:

left -= 100;

or:

margin-left: -200px;

or device-specific rules such as:

@media (max-width: 390px)

unless there is a legitimate reason.

The solution should be based on actual element and viewport dimensions.

The positioning logic should work regardless of:

* screen size
* browser
* orientation
* message position
* picker width

⸻

14. Preserve the existing design

IMPORTANT:

Do NOT redesign the application.

Do NOT change:

* colors
* fonts
* message bubble style
* overall theme
* spacing unnecessarily
* desktop visual design
* icons
* functionality unrelated to this bug

Keep the current UI.

Only change what is required to make the layout responsive and fix the reaction/overflow behavior.

⸻

15. Debug before editing

Before making changes:

1. Inspect the entire frontend structure.
2. Find the chat container.
3. Find the header.
4. Find the message container.
5. Find the message bubble styles.
6. Find the long-press implementation.
7. Find the reaction picker component/styles.
8. Find the composer.
9. Find viewport/meta configuration.
10. Find every relevant fixed width/min-width/100vw rule.
11. Find every relevant absolute/fixed positioning rule.

Then identify the ROOT CAUSE.

Do not immediately start adding random media queries.

⸻

16. Test the final implementation

After implementing the fix, mentally/test against at least these scenarios:

Mobile

* iPhone 320px width
* iPhone 375px width
* iPhone 390px width
* iPhone 430px width
* Android narrow screen
* portrait
* landscape

Desktop

* 1024px
* 1280px
* 1440px
* narrow browser window

Message positions

* top-left
* top-right
* center
* bottom-left
* bottom-right

Interaction

* long press
* click elsewhere
* scroll
* resize
* open keyboard
* close keyboard
* open reaction picker repeatedly

The reaction picker must remain completely visible in every scenario.

⸻

17. Final acceptance criteria

The fix is complete only when ALL of these are true:

* Chat fits the viewport on mobile.
* Chat fits the viewport on desktop.
* No unexplained blank area appears beside the chat.
* No horizontal scrolling is created.
* Header remains inside viewport.
* Composer remains inside viewport.
* Long messages don’t expand the page.
* Reaction picker never goes outside the viewport.
* Reaction picker doesn’t change document width.
* Reaction picker automatically flips/repositions when near an edge.
* Reaction picker works on both left and right messages.
* Reaction picker works near top and bottom of viewport.
* Long press works correctly on touch devices.
* Unwanted native text selection/zoom is avoided where appropriate.
* iOS Safari behaves correctly.
* Desktop behavior is fixed as well.
* Existing visual design is preserved.
* No device-specific hacks were introduced.
* The root cause has been fixed rather than merely hidden with overflow-x: hidden.

⸻

Final response after implementation

When you finish, tell me:

1. What the root cause was.
2. Whether the reaction picker was causing viewport overflow.
3. Which files you changed.
4. What changes you made to the reaction positioning logic.
5. What changes you made to the responsive layout.
6. How you ensured the picker stays inside the viewport.
7. How you verified mobile and desktop behavior.
8. Any remaining edge cases.

Do not claim the issue is fixed unless you have actually inspected the relevant code and addressed the underlying cause.