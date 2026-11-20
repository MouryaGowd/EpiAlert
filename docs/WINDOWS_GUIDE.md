# EpiAlert on Windows: complete guide

Written from the project files. **Not tested on Windows.** If a step fails, note the exact error text.

## Part 1: One-time setup

1. **Install Node.js LTS** (version 20 or newer) from https://nodejs.org. Accept the defaults.
2. **Install Git** from https://git-scm.com (only needed if you clone instead of downloading a ZIP).
3. **Get the project.** In Command Prompt:
   ```
   git clone https://github.com/MouryaGowd/EpiAlert
   cd EpiAlert
   ```
   Or use **Code, Download ZIP** on the repo page and unzip it.
4. Open a new Command Prompt and run `node --version`. It must say v20 or higher.

## Part 2: Run the prototype

1. Double-click `start.bat` in the project folder.
2. The first run installs packages (needs internet), builds, and opens http://localhost:3000. If SmartScreen warns, choose **More info, then Run anyway**.
3. Leave the black window open. Press **Ctrl+C** in it to stop the server.

**Demo walkthrough** (use two browser windows, the second one private or incognito):

1. **Window 1:** sign in with phone `+919999999999`. The 6-digit code appears on screen, since no SMS is sent. This is the admin. Open the **Admin** tab and click **Seed 8 demo responders here**.
2. **Window 2:** sign in with any other number, such as `+919800000001`. Choose a problem type and send the alert.
3. **Window 1:** watch the map and audit log update. Click **+70 s** to see the radius widen to 3 km. Click **+3 min** to see the "Call 108" notice. Click **+25 h** to see the incident expire.
4. **Responder path (optional):** in a third window, sign in with another number, open **Respond**, and register with council `KMC`, reg no `12345`, name `Anita Desai`. It verifies at once. Go on duty, then post from Window 2 and use **I'm coming**.
5. **Review path:** register with any other number (for example `99999`) to land in the admin review queue, then approve it from the admin window.

**Checks to make, since nobody has seen the UI in a real browser:**

- Does every screen render properly?
- Do the maps draw?
- Does it fit a phone-width window (press F12, then the device toolbar)?
- Do the camera and photo steps work? Face blur only works if the browser has face detection; otherwise no photo is sent.
- Are the colours readable in both light and dark mode?

Write down anything that looks wrong.

## Part 3: Run the tests and regenerate the paper numbers

```
start.bat test
start.bat experiments
```

`test` should end with `120 passed`. `experiments` takes about 20 seconds and rewrites the files in `paper\results`. The simulation numbers should match the committed ones, but the geohash and latency timings will differ on your machine. After running it, update the timing tables in `paper\epialert.tex` so they quote your machine, and say which machine in the text.

## Part 4: Compile the paper

**Easiest, no install: Overleaf.**

1. Create a free account at https://www.overleaf.com.
2. Choose **New Project, Upload Project**, and upload a ZIP of just `paper\epialert.tex` and `paper\references.bib`.
3. Set the main file to `epialert.tex` and click **Recompile**.

**Offline alternative: Tectonic.**

1. Download the Windows build from https://tectonic-typesetting.github.io and unzip it.
2. In Command Prompt, go to the `paper` folder and run `path\to\tectonic.exe epialert.tex`.
3. The first run downloads TeX packages (needs internet).

Fix any errors it reports. Red `[TODO: ...]` text in the PDF marks unfinished items.

## Part 5: Finish the paper

It is a draft and is **not submittable** until these are done.

1. **Verify citations.** Open `paper\references.md`. Only 3 of 36 rows are verified. For each row: open its DOI or URL, confirm the title, authors, year and that it says what the "claim" column says, then mark it verified, add it to `references.bib` and cite it. Drop any source you cannot confirm. Never cite from memory.
2. **Check three facts from official pages:**
   - The date India's DPDP Rules were notified (13 vs 14 November 2025).
   - The exact wording of Section 134A of the Motor Vehicles Act (it covers motor-vehicle accidents only).
   - Whether the National Medical Commission register has a public API.
3. **Replace the related-work stub** with a real review, using only verified sources.
4. **Fill in the TODOs:** author names, institution and guide, and the repository URL (`https://github.com/MouryaGowd/EpiAlert`).
5. Recompile and read the whole PDF once.

## Part 6: Slides

1. Install Python from https://www.python.org. On the first screen, tick **Add python.exe to PATH**.
2. In the project folder, run `py ppt\build_deck.py`. It rebuilds `ppt\EpiAlert.pptx` from the current results.
3. **Open the deck in PowerPoint and check every slide.** It has never been rendered. Look for clipped text, overlapping shapes and overflowing boxes.
4. Add your team, guide and institution to slide 1.
5. Once the UI works, add real screenshots of the Report, Alerts and Admin screens. The deck has none.

## Part 7: Save your work back to GitHub

```
git add -A
git commit -m "Describe what you changed"
git push
```

Run `git pull` first if you edited on both laptops.

## Fastest route

Install Claude Code on the Windows laptop, open it in the project folder, and tell it: "Read docs\PROGRESS.md and continue: run the tests, check the UI, verify the citations, and compile the paper." With permissions allowed there, it can do Parts 3 to 6 itself.

## If something fails

| Problem | What to do |
|---|---|
| `node` is not recognised | Close the window and open a new one. If it still fails, reinstall Node and keep the PATH option ticked. |
| Port 3000 is busy | Run `set PORT=4000`, then `start.bat`, then open http://localhost:4000. |
| `npm install` fails | Check the internet connection. A company proxy can block it. |
| Window closes instantly | Open Command Prompt yourself, go to the folder, and run `start.bat`. The text stays on screen. |

## Still true

- The paper is a draft and cannot be submitted until Part 5 is done.
- The slides have not been rendered and have no screenshots.
- The UI has never been opened in a real browser.
- Results are simulated with assumed parameters, and latency numbers are loopback only. A conference will want field evidence, so publication cannot be promised.
