# Relax Techno Fab — QC Control Center

## Complete repaired package
This package contains the complete frontend and backend, including:
- 20-stage sequential QC checklist
- Permanent stage unlock logic based on each stage's successful outcome
- Employer accounts and owner read-only dashboard
- Evidence upload for photos, PDF and TXT files
- Multiple evidence files per stage (up to 10 at once)
- 15 MB maximum per evidence file
- Evidence preview/download and delete
- Clear upload error messages
- Job and stage saving
- Export record

## Windows setup
1. Extract this ZIP into a folder.
2. Open Command Prompt in that folder.
3. Run:
   npm install
4. Start:
   npm start
5. Open:
   http://localhost:3000

The server automatically creates `data/` and `uploads/` folders.

## Accounts
Owner: RELAX FAB / NIKHIL SIR 1
Employer 1: EMPLOYER 1 / RELAX@101
Employer 2: EMPLOYER 2 / RELAX@202
Employer 3: EMPLOYER 3 / RELAX@303
Employer 4: EMPLOYER 4 / RELAX@404

## Evidence upload
Save the Job Details first. Then select/capture evidence in the currently available stage and click Upload Evidence. Images, PDF and TXT files are accepted.

## Stage unlocking
A stage becomes complete only when every checklist point is checked, contractor confirmation is positive, QC verification equals that stage's first outcome, and contractor/QC names or signatures are present. The next stage is then unlocked by the server.
