import * as vscode from 'vscode';

const SECURE_VERSIONS: { [key: string]: string } = {
    'flask': '2.0.1',
    'requests': '2.28.1',
    'pillow': '9.5.0'
};

export class DependencyQuickFixProvider implements vscode.CodeActionProvider {

    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range,
        context: vscode.CodeActionContext
    ): vscode.ProviderResult<vscode.CodeAction[]> {
        
        const actions: vscode.CodeAction[] = [];

        const outdatedDependencyDiagnostic = context.diagnostics.find(
            diag => diag.code?.toString().startsWith('vulnerable-')
        );

        if (outdatedDependencyDiagnostic) {
            const line = document.lineAt(range.start.line);
            const match = line.text.match(/^([a-zA-Z0-9_-]+)/);

            if (match) {
                const libraryName = match[1].toLowerCase();
                const secureVersion = SECURE_VERSIONS[libraryName];

                if (secureVersion) {
                    const fixAction = new vscode.CodeAction(
                        `Upgrade ${libraryName} to secure version ${secureVersion}`,
                        vscode.CodeActionKind.QuickFix
                    );
                        
                    const newText = `${libraryName}==${secureVersion}`;
                    const editPayload = {
                        range: line.range,
                        newText: newText
                    };
                    
                    // Instead of an 'edit', we now provide a 'command'.
                    fixAction.command = {
                        command: 'cognitivtrust.applyFixAndSave',
                        title: 'Apply Fix and Rescan',
                        arguments: [document.uri, editPayload]
                    };
                    
                    actions.push(fixAction);
                }
            }
        }
        
        return actions;
    }
}