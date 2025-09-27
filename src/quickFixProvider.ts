import * as vscode from 'vscode';

interface EditPayload {
    range: vscode.Range;
    newText: string;
    insertText?: { 
        position: vscode.Position;
        text: string;
    };
}

export class HardcodedSecretQuickFixProvider implements vscode.CodeActionProvider {
    
    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext
    ): vscode.ProviderResult<vscode.CodeAction[]> {
        
        const actions: vscode.CodeAction[] = [];
        
        const hardcodedSecretDiagnostic = context.diagnostics.find(
            diag => diag.code?.toString().includes('hardcoded-secret')
        );

        if (hardcodedSecretDiagnostic) {
            // --- FIX 1: The original "Replace with environment variable" fix ---
            const replaceAction = new vscode.CodeAction(
                'Replace with environment variable',
                vscode.CodeActionKind.QuickFix
            );
                
            const line = document.lineAt(range.start.line);
            const text = line.text;
            const match = text.match(/(\w+)\s*=\s*(".*?"|'.*?')/);
            
            if (match) {
                const varName = match[1];
                const editPayload: EditPayload = {
                    range: line.range,
                    newText: `${varName} = os.environ.get("${varName}")`
                };

                if (!document.getText().includes('import os')) {
                    editPayload.insertText = { position: new vscode.Position(0, 0), text: 'import os\n' };
                }
                
                replaceAction.command = {
                    command: 'cognitivtrust.applyFixAndSave',
                    title: 'Apply Fix and Rescan',
                    arguments: [document.uri, editPayload]
                };
                actions.push(replaceAction);
            }
            
            // --- FIX 2: The new "Refactor with AI" fix ---
            const aiFixAction = new vscode.CodeAction(
                'Refactor with AI (Experimental)',
                vscode.CodeActionKind.QuickFix
            );
            aiFixAction.command = {
                command: 'cognitivtrust.refactorWithAI',
                title: 'Refactor with AI',
                // Pass the document's URI and the exact range of the insecure code
                arguments: [document.uri, hardcodedSecretDiagnostic.range]
            };
            actions.push(aiFixAction);
        }
        
        return actions;
    }
}