import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import axios from 'axios';
import { HardcodedSecretQuickFixProvider } from './quickFixProvider';
import { DependencyQuickFixProvider } from './dependencyQuickFixProvider';

const diagnosticCollection = vscode.languages.createDiagnosticCollection('cognitivtrust');

export function activate(context: vscode.ExtensionContext) {

    // --- COMMAND: Apply Fix, Save, and Rescan ---
    const applyFixAndSaveCommand = vscode.commands.registerCommand('cognitivtrust.applyFixAndSave', async (uri: vscode.Uri, edit: { range: vscode.Range, newText: string, insertText?: { position: vscode.Position, text: string } }) => {
        const workspaceEdit = new vscode.WorkspaceEdit();
        if (edit.insertText) {
            workspaceEdit.insert(uri, edit.insertText.position, edit.insertText.text);
        }
        workspaceEdit.replace(uri, edit.range, edit.newText);

        await vscode.workspace.applyEdit(workspaceEdit);
        
        const fixCount = context.workspaceState.get('fixCount', 0) as number;
        context.workspaceState.update('fixCount', fixCount + 1);
        
        const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
        if (document) {
            await document.save();
        }
    });
    context.subscriptions.push(applyFixAndSaveCommand);

    // --- COMMAND: Show Fix Statistics ---
    const showStatsCommand = vscode.commands.registerCommand('cognitivtrust.showStats', () => {
        const fixCount = context.workspaceState.get('fixCount', 0);
        vscode.window.showInformationMessage(`CognitiveTrust has applied ${fixCount} fix(es) in this workspace.`);
    });
    context.subscriptions.push(showStatsCommand);

    // --- COMMAND: Scan Entire Workspace ---
    const scanWorkspaceCommand = vscode.commands.registerCommand('cognitivtrust.scanWorkspace', () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('Please open a folder to scan the workspace.');
            return;
        }
        const workspacePath = workspaceFolder.uri.fsPath;
        const rulesPath = path.join(context.extensionPath, 'rules');

        vscode.window.showInformationMessage('Starting workspace scan...');

        execFile('semgrep', ['scan', '--json', '--config', rulesPath, workspacePath], { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
            if (error) { console.error("Exec error:", error); return; }
            if (stderr && !stdout) { console.error('Semgrep stderr:', stderr); return; }
            
            diagnosticCollection.clear();

            if (stdout) {
                try {
                    const results = JSON.parse(stdout);
                    const diagnosticsMap = parseSemgrepResults(results);
                    
                    diagnosticsMap.forEach((diagnostics, filePath) => {
                        const fileUri = vscode.Uri.file(filePath);
                        diagnosticCollection.set(fileUri, diagnostics);
                    });
                    vscode.window.showInformationMessage(`Workspace scan finished. Found issues in ${diagnosticsMap.size} file(s).`);
                } catch (e) {
                    console.error("Failed to parse Semgrep JSON output:", e);
                }
            }
        });
    });
    context.subscriptions.push(scanWorkspaceCommand);

    // --- COMMAND: Refactor with AI (UPDATED WITH SAFER PARSING) ---
    const refactorWithAICommand = vscode.commands.registerCommand('cognitivtrust.refactorWithAI', async (documentUri: vscode.Uri, range: vscode.Range) => {
        const apiKey = vscode.workspace.getConfiguration('cognitivtrust.openai').get('apiKey');
        if (!apiKey) {
            vscode.window.showErrorMessage('OpenAI API key is not set. Please set it in your VS Code settings.');
            return;
        }

        const document = await vscode.workspace.openTextDocument(documentUri);
        const insecureCode = document.getText(range);
        
        const prompt = `You are an expert security programmer. Refactor the following Python code to make it secure. Only return the refactored code, with no explanation or preamble.\n\nCode:\n${insecureCode}`;

        try {
            vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "CognitiveTrust", cancellable: false }, async (progress) => {
                progress.report({ message: "Asking AI to refactor code..." });
                const response = await axios.post('https://api.openai.com/v1/chat/completions', {
                    model: 'gpt-3.5-turbo',
                    messages: [{ role: 'user', content: prompt }]
                }, {
                    headers: { 'Authorization': `Bearer ${apiKey}` }
                });

                // --- THIS IS THE SAFER CHECK ---
                const choices = response.data.choices;
                if (choices && choices.length > 0 && choices[0].message && choices[0].message.content) {
                    const refactoredCode = choices[0].message.content.trim();
                    const workspaceEdit = new vscode.WorkspaceEdit();
                    workspaceEdit.replace(documentUri, range, refactoredCode);
                    await vscode.workspace.applyEdit(workspaceEdit);
                    await document.save();
                } else {
                    // Handle cases where the API returns an empty or unexpected response
                    console.error("OpenAI API returned an unexpected response structure:", response.data);
                    vscode.window.showErrorMessage('AI refactoring failed: The API returned an empty or invalid response.');
                }
            });
        } catch (error) {
            console.error("OpenAI API error:", error);
            vscode.window.showErrorMessage('Failed to refactor code using OpenAI API. Check the Developer Console for details.');
        }
    });
    context.subscriptions.push(refactorWithAICommand);


    // --- EVENT LISTENERS AND PROVIDER REGISTRATIONS ---
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(document => {
            if (document.languageId === 'python' || path.basename(document.fileName) === 'requirements.txt') {
                runSecurityScan(document, context);
            }
        }),

        vscode.workspace.onDidCloseTextDocument(document => {
            diagnosticCollection.delete(document.uri);
        }),
        
        vscode.languages.registerCodeActionsProvider(
            { language: 'python' },
            new HardcodedSecretQuickFixProvider()
        ),

        vscode.languages.registerCodeActionsProvider(
            { pattern: '**/requirements.txt' },
            new DependencyQuickFixProvider()
        )
    );

    // Initial scan on startup
    if (vscode.window.activeTextEditor) {
        const document = vscode.window.activeTextEditor.document;
        if (document.languageId === 'python' || path.basename(document.fileName) === 'requirements.txt') {
            runSecurityScan(document, context);
        }
    }
}

// This function scans a single file, used by the onDidSave listener
function runSecurityScan(document: vscode.TextDocument, context: vscode.ExtensionContext) {
    const rulesPath = path.join(context.extensionPath, 'rules');
    const filePath = document.fileName;

    execFile('semgrep', ['scan', '--json', '--config', rulesPath, filePath], (error, stdout, stderr) => {
        if (error) { console.error("Exec error:", error); return; }
        if (stderr && !stdout) { console.error('Semgrep stderr:', stderr); return; }

        diagnosticCollection.delete(document.uri);

        if (stdout) {
            try {
                const results = JSON.parse(stdout);
                const diagnosticsMap = parseSemgrepResults(results);
                diagnosticsMap.forEach((diagnostics, filePath) => {
                    diagnosticCollection.set(vscode.Uri.file(filePath), diagnostics);
                });
            } catch (e) {
                console.error("Failed to parse Semgrep JSON output:", e);
            }
        }
    });
}

// UPDATED: This function can now handle results from multiple files
function parseSemgrepResults(semgrepOutput: any): Map<string, vscode.Diagnostic[]> {
    const diagnosticsByFile = new Map<string, vscode.Diagnostic[]>();

    for (const issue of semgrepOutput.results) {
        const filePath = issue.path;
        
        if (!diagnosticsByFile.has(filePath)) {
            diagnosticsByFile.set(filePath, []);
        }

        const range = new vscode.Range(issue.start.line - 1, issue.start.col - 1, issue.end.line - 1, issue.end.col - 1);
        const diagnostic = new vscode.Diagnostic(range, issue.extra.message, issue.extra.severity === 'ERROR' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
        diagnostic.code = issue.check_id;
        
        diagnosticsByFile.get(filePath)?.push(diagnostic);
    }
    return diagnosticsByFile;
}

export function deactivate() {}