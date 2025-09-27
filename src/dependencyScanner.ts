// src/dependencyScanner.ts

import * as vscode from 'vscode';

// 1. "Simulate this if needed": This is the simulated database of vulnerable libraries.
const VULNERABLE_LIBRARIES: { [key: string]: string } = {
    'flask': '1.1.2',
    'requests': '2.22.0',
    'pillow': '9.0.0'
};

// This function is now exported so it can be used by extension.ts
export function checkDependencies(document: vscode.TextDocument, diagnosticCollection: vscode.DiagnosticCollection) {
    const diagnostics: vscode.Diagnostic[] = [];
    const lines = document.getText().split('\n');

    // 2. "Parse ... requirements.txt" and "Only scan current file"
    //    This logic reads the current file line-by-line to find issues.
    lines.forEach((lineText, lineNumber) => {
        const match = lineText.match(/^([a-zA-Z0-9_-]+)==([0-9.]+)/);
        if (match) {
            const libraryName = match[1].toLowerCase();
            const version = match[2];

            if (VULNERABLE_LIBRARIES[libraryName] && version <= VULNERABLE_LIBRARIES[libraryName]) {
                const range = new vscode.Range(lineNumber, 0, lineNumber, lineText.length);
                const message = `Vulnerability found: ${libraryName} version ${version} is outdated. Please upgrade.`;
                const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);
                diagnostic.code = 'vulnerable-dependency'; // Tag for the Quick Fix provider
                diagnostics.push(diagnostic);
            }
        }
    });

    // Update the collection with the findings for this file
    diagnosticCollection.set(document.uri, diagnostics);
}