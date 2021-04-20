import ts from "byots";
import { errors } from "Shared/diagnostics";
import { getOrSetDefault } from "Shared/util/getOrSetDefault";
import { TransformState } from "TSTransformer";
import { DiagnosticService } from "TSTransformer/classes/DiagnosticService";
import { skipUpwards } from "TSTransformer/util/traversal";
import { walkTypes } from "TSTransformer/util/types";

function getThisParameter(parameters: ts.NodeArray<ts.ParameterDeclaration>) {
	const firstParam = parameters[0];
	if (firstParam) {
		const name = firstParam.name;
		if (ts.isIdentifier(name) && ts.isThisIdentifier(name)) {
			return name;
		}
	}
}

function isMethodDeclaration(state: TransformState, node: ts.Node): boolean {
	if (ts.isFunctionLike(node)) {
		const thisParam = getThisParameter(node.parameters);
		if (thisParam) {
			return !(state.getType(thisParam).flags & ts.TypeFlags.Void);
		} else {
			// namespace declare functions with `this` arg defined (i.e. utf8)
			if (ts.isFunctionDeclaration(node)) {
				return false;
			}

			if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) {
				return true;
			}

			// for some reason, FunctionExpressions within ObjectLiteralExpressions are implicitly methods
			if (ts.isFunctionExpression(node)) {
				const parent = skipUpwards(node).parent;
				if (ts.isPropertyAssignment(parent)) {
					const grandparent = skipUpwards(parent).parent;
					if (ts.isObjectLiteralExpression(grandparent)) {
						return true;
					}
				}
			}

			return false;
		}
	}
	return false;
}

function isMethodInner(
	state: TransformState,
	node: ts.PropertyAccessExpression | ts.ElementAccessExpression | ts.SignatureDeclarationBase,
	type: ts.Type,
): boolean {
	let hasMethodDefinition = false;
	let hasCallbackDefinition = false;

	const declarations = type.symbol.getDeclarations();
	if (declarations) {
		for (const declaration of declarations) {
			if (ts.isTypeLiteralNode(declaration)) {
				for (const callSignature of type.getCallSignatures()) {
					if (callSignature.declaration) {
						if (isMethodDeclaration(state, callSignature.declaration)) {
							hasMethodDefinition = true;
						} else {
							hasCallbackDefinition = true;
						}
					}
				}
			} else {
				if (isMethodDeclaration(state, declaration)) {
					hasMethodDefinition = true;
				} else {
					hasCallbackDefinition = true;
				}
			}
		}
	}

	if (hasMethodDefinition && hasCallbackDefinition) {
		DiagnosticService.addDiagnostic(errors.noMixedTypeCall(node));
	}

	return hasMethodDefinition;
}

function isMethodInner2(
	state: TransformState,
	node: ts.PropertyAccessExpression | ts.ElementAccessExpression | ts.SignatureDeclarationBase,
	type: ts.Type,
) {
	let hasMethodDefinition = false;
	let hasCallbackDefinition = false;

	for (const callSignature of state.getType(node).getCallSignatures()) {
		const thisValueDeclaration = callSignature.thisParameter?.valueDeclaration;
		if (thisValueDeclaration) {
			if (!(state.getType(thisValueDeclaration).flags & ts.TypeFlags.Void)) {
				hasMethodDefinition = true;
			} else {
				hasCallbackDefinition = true;
			}
		} else if (callSignature.declaration) {
			if (isMethodDeclaration(state, callSignature.declaration)) {
				hasMethodDefinition = true;
			} else {
				hasCallbackDefinition = true;
			}
		}
	}

	if (hasMethodDefinition && hasCallbackDefinition) {
		DiagnosticService.addDiagnostic(errors.noMixedTypeCall(node));
	}

	return hasMethodDefinition;
}

export function isMethod(
	state: TransformState,
	node: ts.PropertyAccessExpression | ts.ElementAccessExpression | ts.SignatureDeclarationBase,
): boolean {
	let result = false;

	walkTypes(state.getType(node), t => {
		if (t.symbol) {
			result =
				result ||
				getOrSetDefault(state.multiTransformState.isMethodCache, t.symbol, () => isMethodInner(state, node, t));
		}
	});

	return result;
}
